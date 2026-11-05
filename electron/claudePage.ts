export const CLAUDE_PAGE_API = `
globalThis.__afClaude = (function () {
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function queryAll(sel) {
    var out = [];
    var seen = new Set();
    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      var nodes;
      try { nodes = root.querySelectorAll(sel); } catch (e) { return; }
      for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
      var all;
      try { all = root.querySelectorAll('*'); } catch (e2) { return; }
      for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) walk(all[j].shadowRoot);
    }
    walk(document);
    return out;
  }
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 80 && r.height > 16;
  }
  function labelOf(el) {
    return ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '')).trim();
  }
  function composer() {
    var nodes = queryAll('div[contenteditable="true"], textarea').filter(function (el) {
      return visible(el) && el.getAttribute('aria-hidden') !== 'true';
    });
    nodes.sort(function (a, b) { return b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom; });
    return nodes[0] || null;
  }
  function controlNamed(el, name, testId) {
    var names = [el.getAttribute('aria-label') || '', el.innerText || ''];
    for (var i = 0; i < names.length; i++) {
      if (name.test(names[i].replace(/\\s+/g, ' ').trim())) return true;
    }
    return testId.test(el.getAttribute('data-testid') || '');
  }
  function sendButton() {
    var buttons = queryAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      if (controlNamed(b, /^send(\\s+message)?$/i, /^send(-message)?-button$/i)) return b;
    }
    return null;
  }
  function stopButton() {
    var buttons = queryAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (controlNamed(buttons[i], /^stop(\\s+(respons(e|ing)|generating))?$/i, /^stop(-response)?-button$/i)) return buttons[i];
    }
    return null;
  }
  function dialogText() {
    return queryAll('[role="dialog"], [aria-modal="true"]').map(function (el) { return el.innerText || ''; }).join('\\n');
  }
  function challenge() {
    if (queryAll('iframe[src*="captcha" i], iframe[src*="hcaptcha" i], iframe[src*="recaptcha" i], iframe[src*="challenges.cloudflare" i]').length) return true;
    return /verify you are human|unusual activity|security check/i.test(dialogText());
  }
  function signedOut() {
    var href = location.href;
    if (/\\/login|\\/magic-link/i.test(location.pathname)) return true;
    if (/accounts\\.google\\.com|login\\.microsoftonline\\.com|appleid\\.apple\\.com/i.test(location.hostname)) return true;
    return /\\/login/i.test(href) && !composer();
  }
  function chatId() {
    var m = location.pathname.match(/\\/chat\\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }
  function messageText(m) {
    if (!m) return '';
    var parts = [];
    var content = m.content || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') parts.push(content[i].text);
    }
    if (!parts.length && typeof m.text === 'string') parts.push(m.text);
    var files = m.attachments || [];
    for (var j = 0; j < files.length; j++) {
      if (files[j] && typeof files[j].extracted_content === 'string') parts.push(files[j].extracted_content);
    }
    return parts.join('');
  }
  // The conversation as Claude.ai's own page loads it: the reply exactly as written (no rendering,
  // no curly quotes) and the prompt it answers. Same origin and session as the open page.
  async function readReply() {
    var id = chatId();
    if (!id) return { ok: false, why: 'no chat yet' };
    try {
      var org = '';
      var cookie = document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/);
      if (cookie) org = decodeURIComponent(cookie[1]);
      if (!org) {
        var orgs = await fetch('/api/organizations', { credentials: 'include' });
        if (!orgs.ok) return { ok: false, why: 'organizations ' + orgs.status };
        var list = await orgs.json();
        org = (list && list[0] && list[0].uuid) || '';
      }
      if (!org) return { ok: false, why: 'no organization' };
      var res = await fetch('/api/organizations/' + encodeURIComponent(org) + '/chat_conversations/' + id + '?tree=True&rendering_mode=messages&render_all_tools=true', { credentials: 'include' });
      if (!res.ok) return { ok: false, why: 'conversation ' + res.status };
      var conv = await res.json();
      var msgs = (conv && conv.chat_messages) || [];
      var byId = {};
      for (var i = 0; i < msgs.length; i++) byId[msgs[i].uuid] = msgs[i];
      var leaf = (conv.current_leaf_message_uuid && byId[conv.current_leaf_message_uuid]) || msgs[msgs.length - 1];
      if (!leaf) return { ok: true, prompt: '', text: '', humans: 0, done: false };
      var answer = leaf.sender === 'assistant' ? leaf : null;
      var human = answer ? byId[answer.parent_message_uuid] : leaf;
      var humans = 0;
      for (var k = 0; k < msgs.length; k++) if (msgs[k].sender === 'human') humans++;
      return {
        ok: true,
        prompt: messageText(human).slice(0, 600),
        text: answer ? messageText(answer) : '',
        humans: humans,
        done: !!(answer && answer.stop_reason)
      };
    } catch (e) {
      return { ok: false, why: String(e && e.message || e).slice(0, 200) };
    }
  }
  function insideUser(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.getAttribute && /user-message/i.test(node.getAttribute('data-testid') || '')) return true;
      node = node.parentElement;
    }
    return false;
  }
  function textAfter(user) {
    var node = user;
    for (var depth = 0; depth < 6 && node; depth++) {
      var sib = node.nextElementSibling;
      var parts = [];
      while (sib) {
        if (sib.querySelector && sib.querySelector('[contenteditable="true"], textarea')) break;
        if (!insideUser(sib)) parts.push(sib.innerText || '');
        sib = sib.nextElementSibling;
      }
      var text = parts.join('\\n').trim();
      if (text) return text;
      node = node.parentElement;
    }
    return '';
  }
  function lastUserMessage() {
    var users = queryAll('[data-testid="user-message"], [data-testid*="user-message"]');
    return users.length ? users[users.length - 1] : null;
  }
  // In a reused chat earlier answers stay on the page; only what follows the newest prompt is its reply.
  function afterLastUser(el) {
    var user = lastUserMessage();
    if (!user) return true;
    return user !== el && !user.contains(el) && !!(user.compareDocumentPosition(el) & 4);
  }
  function jsonFromCodeBlocks() {
    var nodes = queryAll('pre, code, [data-testid*="code"], [class*="code-block"]');
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (insideUser(nodes[i]) || !afterLastUser(nodes[i])) continue;
      var t = (nodes[i].innerText || '').trim();
      if (t.charAt(0) === '{' && /"companies"|"company_name"/.test(t)) return clip(t);
    }
    return '';
  }
  function assistantParts() {
    var nodes = queryAll('[data-testid="assistant-message"], [data-testid*="assistant-message"], [data-testid="ai-message"], [data-message-author="assistant"], .font-claude-response, .standard-markdown, .font-claude-message');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (insideUser(nodes[i]) || !afterLastUser(nodes[i])) continue;
      var t = (nodes[i].innerText || '').trim();
      if (t) out.push(t);
    }
    return out;
  }
  function assistantText() {
    var code = jsonFromCodeBlocks();
    if (code) return code;
    var parts = assistantParts();
    for (var j = parts.length - 1; j >= 0; j--) {
      if (/\"companies\"|\"company_name\"/.test(parts[j])) return clip(parts[j]);
    }
    if (parts.length) return clip(parts[parts.length - 1]);
    var users = queryAll('[data-testid="user-message"], [data-testid*="user-message"]');
    var user = users.length ? users[users.length - 1] : null;
    if (user) {
      var followed = textAfter(user);
      if (followed) return clip(followed);
    }
    return '';
  }
  function clip(text) {
    if (text.length > 400000) return text.slice(text.length - 400000);
    return text;
  }
  function modelLabel() {
    var buttons = queryAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].innerText || '').replace(/\\s+/g, ' ').trim();
      if (/sonnet|opus|haiku|claude/i.test(t) && t.length < 80) return 'claude.ai (' + t + ')';
    }
    return 'claude.ai';
  }
  function snapshot() {
    try { performance.setResourceTimingBufferSize(800); } catch (e) {}
    var box = composer();
    return {
      href: location.href,
      composer: !!box,
      sendEnabled: !!sendButton(),
      stop: !!stopButton(),
      assistant: assistantText(),
      fresh: !!lastUserMessage() && assistantParts().length > 0,
      model: modelLabel(),
      challenge: challenge(),
      signedOut: signedOut(),
      usageLimited: /message limit|usage limit|rate limit/i.test(dialogText()),
      chatId: chatId()
    };
  }
  function textOf(el) {
    if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && 'value' in el) return String(el.value || '');
    return String(el.innerText || '');
  }
  function placeCaret(el) {
    el.focus();
    var sel = window.getSelection && window.getSelection();
    if (!sel || !document.createRange) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function grow(el, part, method) {
    var before = textOf(el).length;
    if (method === 'beforeinput') {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: part }));
    } else if (method === 'paste') {
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', part);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      } catch (e) { return false; }
    } else {
      try { document.execCommand('insertText', false, part); } catch (e2) { return false; }
    }
    return textOf(el).length > before;
  }
  function insert() {
    var text = String(globalThis.__afPrompt || '');
    try { performance.clearResourceTimings(); } catch (e) {}
    var el = composer();
    if (!el || !text) return false;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var proto = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
      if (proto && proto.set) proto.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      placeCaret(el);
      var chosen = null;
      var methods = ['beforeinput', 'paste', 'exec'];
      for (var i = 0; i < text.length; i += 16000) {
        var part = text.slice(i, i + 16000);
        var list = chosen ? [chosen] : methods;
        var grew = false;
        for (var m = 0; m < list.length; m++) {
          placeCaret(el);
          if (grow(el, part, list[m])) { chosen = list[m]; grew = true; break; }
        }
        if (!grew) return false;
      }
    }
    var needle = text.replace(/\\s+/g, ' ').trim().slice(0, 40);
    var got = textOf(el).replace(/\\s+/g, ' ');
    return got.indexOf(needle) !== -1 || got.length >= Math.min(text.length, 80);
  }
  function clickSend() {
    var b = sendButton();
    if (!b) return false;
    b.click();
    return true;
  }
  function clickStop() {
    var b = stopButton();
    if (!b) return false;
    b.click();
    return true;
  }
  function walkOrg(value, depth) {
    if (!value || depth > 6 || typeof value !== 'object') return null;
    if (!Array.isArray(value)) {
      var uuid = typeof value.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(value.uuid) ? value.uuid : null;
      if (uuid && (value.settings || value.capabilities || value.billing_type || value.type === 'organization')) return uuid;
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var child = value[key];
        if (/organization/i.test(key)) {
          if (typeof child === 'string' && /^[0-9a-f-]{36}$/i.test(child)) return child;
          if (child && typeof child.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(child.uuid)) return child.uuid;
        }
      }
    }
    var nested = Array.isArray(value) ? value : Object.keys(value).map(function (k) { return value[k]; });
    for (var n = 0; n < nested.length; n++) {
      var hit = walkOrg(nested[n], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  function orgFromPerformance() {
    var entries = [];
    try { entries = performance.getEntriesByType('resource'); } catch (e) { return null; }
    for (var i = entries.length - 1; i >= 0; i--) {
      var m = String(entries[i].name || '').match(/\\/api\\/organizations\\/([0-9a-f-]{36})/i);
      if (m) return m[1];
    }
    return null;
  }
  function findOrg() {
    var fromPerf = orgFromPerformance();
    if (fromPerf) return Promise.resolve(fromPerf);
    var paths = ['/api/organizations', '/api/account', '/api/bootstrap'];
    var chain = Promise.resolve(null);
    paths.forEach(function (path) {
      chain = chain.then(function (found) {
        if (found) return found;
        return fetch(path, { credentials: 'include', headers: { accept: 'application/json' } }).then(function (res) {
          if (!res.ok) return null;
          return res.json().then(function (data) { return walkOrg(data, 0); }).catch(function () { return null; });
        }).catch(function () { return null; });
      });
    });
    return chain;
  }
  function renameViaFetch(org, id, title) {
    var url = '/api/organizations/' + org + '/chat_conversations/' + id;
    var bodies = [JSON.stringify({ name: title }), JSON.stringify({ title: title })];
    var methods = ['PUT', 'PATCH'];
    var chain = Promise.resolve(false);
    methods.forEach(function (method) {
      bodies.forEach(function (body) {
        chain = chain.then(function (ok) {
          if (ok) return true;
          return fetch(url, { method: method, credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: body })
            .then(function (res) { return !!res.ok; })
            .catch(function () { return false; });
        });
      });
    });
    return chain;
  }
  function renameViaUi(id, title) {
    var link = document.querySelector('a[href*="' + id + '"]');
    if (!link) return Promise.resolve(false);
    var row = link.closest('li, div') || link.parentElement;
    var more = null;
    if (row) {
      var buttons = row.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        if (/more|options|menu|rename/i.test(labelOf(buttons[i]) + ' ' + (buttons[i].textContent || ''))) { more = buttons[i]; break; }
      }
    }
    if (more) more.click();
    else link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    return sleep(250).then(function () {
      var items = queryAll('[role="menuitem"], button');
      var item = null;
      for (var i = 0; i < items.length; i++) {
        if (/^rename$/i.test((items[i].textContent || '').trim())) { item = items[i]; break; }
      }
      if (!item) return false;
      item.click();
      return sleep(200).then(function () {
        var active = document.activeElement;
        if (!active || active === link) return false;
        var wide = active.getBoundingClientRect && active.getBoundingClientRect().width > 500;
        if (wide && active.getAttribute && active.getAttribute('contenteditable') === 'true') return false;
        if ('value' in active) {
          var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (proto && proto.set) proto.set.call(active, title);
          else active.value = title;
          active.dispatchEvent(new Event('input', { bubbles: true }));
        }
        active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        if (active.blur) active.blur();
        return sleep(300).then(function () {
          var again = document.querySelector('a[href*="' + id + '"]');
          return !!(again && (again.textContent || '').indexOf(title.slice(0, 16)) !== -1);
        });
      });
    });
  }
  function rename() {
    var title = String(globalThis.__afTitle || '').trim();
    var id = chatId();
    if (!title || !id) return Promise.resolve(false);
    return findOrg().then(function (org) {
      if (!org) return false;
      return renameViaFetch(org, id, title);
    }).then(function (ok) {
      if (ok) return true;
      return renameViaUi(id, title);
    }).catch(function () { return false; });
  }
  return { snapshot: snapshot, insert: insert, clickSend: clickSend, clickStop: clickStop, rename: rename, readReply: readReply };
})();
true;
`;
