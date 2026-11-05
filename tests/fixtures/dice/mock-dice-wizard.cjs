(function (root) {
  'use strict';

  var SEARCH_HEADER =
    '<header class="site-header">' +
    '<a href="/" class="logo" aria-label="MockDice test page">MockDice</a>' +
    '<nav aria-label="Main"><a href="/jobs">Find Jobs</a><a href="/career-paths">Career Paths</a><a href="/career-advice">Career Advice</a><a href="/employers">Employers</a></nav>' +
    '<form class="search" action="/jobs"><input name="q" aria-label="Job title, skill, company, keyword" placeholder="Job title, skill, company, keyword">' +
    '<input name="location" aria-label="Location" placeholder="Location"><button type="submit">Search</button></form>' +
    '</header>';
  var SLIM_HEADER =
    '<header class="site-header slim">' +
    '<a href="/" class="logo" aria-label="MockDice home">MockDice</a>' +
    '<div class="icons"><button type="button" aria-label="Messages">💬</button><button type="button" aria-label="Profile">👥</button><button type="button" aria-label="Menu">☰</button></div>' +
    '</header>';
  var SITE_FOOTER = '<footer class="site-footer"><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/help">Help</a></footer>';
  var DOTS = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>';
  var PENCIL = '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" fill="none" stroke="currentColor"/></svg>';
  var ARROW = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor"/></svg>';
  var BRIEFCASE = '<svg class="art" width="80" height="64" viewBox="0 0 80 64" aria-hidden="true"><rect x="10" y="18" width="60" height="40" rx="6" fill="none" stroke="#333"/><rect x="30" y="10" width="20" height="10" rx="3" fill="none" stroke="#333"/></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function mountDiceWizard(doc, opts) {
    opts = opts || {};
    var total = opts.steps === 2 ? 2 : 3;
    var state = {
      step: 1,
      resume: opts.profileResume || 'Jordan_Rivera_Resume_2025.pdf',
      resumeReplaced: false,
      coverLetter: null,
      answers: { q_auth: '', q_spon: '', q_years: '', q_hear: '' },
      submitClicks: 0,
      submitted: false,
      nativePickerOpened: 0,
    };
    var company = opts.company || 'Meridian Credit Analytics LLC';

    doc.body.innerHTML =
      (opts.header === 'slim' ? SLIM_HEADER : SEARCH_HEADER) +
      '<div id="__next"><main class="page"><div class="wizard-shell">' +
      '<div class="wizard-head">' + BRIEFCASE + '<p class="eyebrow">You’re Applying for</p><h1>' + esc(opts.title || 'Senior Software Engineer') + '</h1>' +
      '<p class="company">@ ' + esc(company) + ' in ' + esc(opts.location || 'Chicago, IL') + '</p></div>' +
      '<div class="progress"><span></span></div><div class="steps" aria-live="polite"></div>' +
      '<div class="content"></div>' +
      '<footer class="wizard-nav"></footer>' +
      '</div></main></div>' +
      SITE_FOOTER;

    var shell = doc.querySelector('.wizard-shell');
    var content = doc.querySelector('.content');
    var steps = doc.querySelector('.steps');
    var bar = doc.querySelector('.progress span');
    var nav = doc.querySelector('.wizard-nav');

    function fileChosen(input, cb) {
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (f) cb(f.name);
      });
    }

    function closeMenu() {
      var m = doc.querySelector('.portal-menu');
      if (m) m.remove();
    }

    function renderStep1() {
      content.innerHTML =
        '<h2>Resume &amp; Cover Letter</h2>' +
        '<section class="doc-section"><h3>Resume <span class="req" aria-hidden="true">*</span><span class="sr-only">required</span></h3>' +
        '<div class="file-card"><a href="#" class="file-link">' + esc(state.resume) + '</a>' +
        '<span class="meta">' + (state.resumeReplaced ? 'Uploaded just now' : 'From your Dice profile') + '</span>' +
        '<button type="button" class="icon-button">' + DOTS + '</button>' +
        '</div></section>' +
        '<section class="doc-section"><h3>Cover Letter</h3>' +
        (state.coverLetter
          ? '<div class="file-card"><span class="file-name">' + esc(state.coverLetter) + '</span><button type="button" class="remove">Remove</button></div>'
          : '<form class="dropzone" data-testid="wizard-cover-letter-upload"><p>Drag &amp; drop your cover letter here or</p><button type="button" class="browse">Upload</button><p class="hint">PDF, DOC or DOCX up to 5 MB</p>' +
            '<input type="file" accept=".pdf,.doc,.docx" style="display:none"></form>') +
        '</section>';

      var kebab = content.querySelector('.icon-button');
      kebab.addEventListener('click', function () {
        if (doc.querySelector('.portal-menu')) return closeMenu();
        var r = kebab.getBoundingClientRect ? kebab.getBoundingClientRect() : { bottom: 0, right: 0 };
        var menu = doc.createElement('div');
        menu.className = 'portal-menu';
        menu.setAttribute('role', 'menu');
        menu.style.top = (r.bottom + (doc.defaultView ? doc.defaultView.scrollY : 0) + 4) + 'px';
        menu.style.left = Math.max(8, r.right - 160) + 'px';
        menu.innerHTML = '<div role="menuitem" tabindex="0">Download</div><div role="menuitem" tabindex="0">Replace</div>';
        doc.body.appendChild(menu);
        menu.querySelectorAll('[role=menuitem]')[1].addEventListener('click', function () {
          closeMenu();
          var input = doc.createElement('input');
          input.type = 'file';
          input.accept = '.pdf,.doc,.docx';
          fileChosen(input, function (name) {
            state.resume = name;
            state.resumeReplaced = true;
            renderStep1();
          });
          input.click();
          if (!input.hasAttribute('data-applyflow-file-target')) state.nativePickerOpened++;
        });
      });
      var dz = content.querySelector('.dropzone');
      if (dz) {
        var input = dz.querySelector('input[type=file]');
        dz.querySelector('.browse').addEventListener('click', function () {
          input.click();
        });
        fileChosen(input, function (name) {
          state.coverLetter = name;
          renderStep1();
        });
        dz.addEventListener('drop', function (e) {
          e.preventDefault();
          var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) {
            state.coverLetter = f.name;
            renderStep1();
          }
        });
      }
      var rm = content.querySelector('.remove');
      if (rm) {
        rm.addEventListener('click', function () {
          state.coverLetter = null;
          renderStep1();
        });
      }
    }

    function radio(name, value, label) {
      var checked = state.answers[name] === value ? ' checked' : '';
      return '<label><input type="radio" name="' + name + '" value="' + value + '"' + checked + '> ' + label + '</label>';
    }

    function renderQuestions(error) {
      content.innerHTML =
        '<h2>Employer Questions</h2>' +
        (error ? '<div role="alert" class="error">' + esc(error) + '</div>' : '') +
        '<div class="q"><p>Are you legally authorized to work in the United States? *</p><div role="radiogroup">' + radio('q_auth', 'yes', 'Yes') + radio('q_auth', 'no', 'No') + '</div></div>' +
        '<div class="q"><p>Will you now or in the future require visa sponsorship? *</p><div role="radiogroup">' + radio('q_spon', 'yes', 'Yes') + radio('q_spon', 'no', 'No') + '</div></div>' +
        '<div class="q"><label for="q_years">How many years of experience do you have with Java? *</label><input id="q_years" type="text" value="' + esc(state.answers.q_years) + '"></div>' +
        '<div class="q"><label for="q_hear">How did you hear about this job?</label><select id="q_hear"><option value="">Select</option><option>Dice</option><option>LinkedIn</option><option>Referral</option></select></div>';
      content.querySelectorAll('input[type=radio]').forEach(function (r) {
        r.addEventListener('change', function () {
          state.answers[r.name] = r.value;
        });
      });
      var years = content.querySelector('#q_years');
      years.addEventListener('input', function () {
        state.answers.q_years = years.value;
      });
      var hear = content.querySelector('#q_hear');
      hear.value = state.answers.q_hear;
      hear.addEventListener('change', function () {
        state.answers.q_hear = hear.value;
      });
    }

    function reviewCard(title, value, required, editLabel) {
      return (
        '<div class="review-card"><div><h3>' + esc(title) + (required ? ' <span class="req">*</span>' : '') + '</h3><p class="value">' + esc(value) + '</p></div>' +
        '<button type="button" class="round-edit" aria-label="' + esc(editLabel) + '">' + PENCIL + '</button></div>'
      );
    }

    function renderReview() {
      content.innerHTML =
        '<h2>Review your application</h2>' +
        '<p class="lede">Take a moment to review the documents you’re submitting for this application. Once you submit, this action cannot be undone.</p>' +
        reviewCard('Resume', state.resume, true, 'Edit resume') +
        reviewCard('Cover Letter', state.coverLetter || 'None', false, 'Edit cover letter') +
        (total === 3
          ? reviewCard('Work Authorization', state.answers.q_auth === 'yes' ? 'Authorized' : state.answers.q_auth || 'Not answered', true, 'Edit work authorization') +
            reviewCard('Sponsorship', state.answers.q_spon || 'Not answered', true, 'Edit sponsorship') +
            reviewCard('Years with Java', state.answers.q_years || 'Not answered', true, 'Edit experience')
          : reviewCard('Work Authorization', 'US Citizen', true, 'Edit work authorization'));
      content.querySelectorAll('.round-edit').forEach(function (b, i) {
        b.addEventListener('click', function () {
          state.step = i <= 1 ? 1 : 2;
          render();
        });
      });
    }

    function render(error) {
      closeMenu();
      steps.textContent = 'Step ' + state.step + ' of ' + total;
      bar.style.width = Math.round((state.step / total) * 100) + '%';
      var last = state.step === total;
      nav.innerHTML =
        '<button type="button" class="btn-back">Back</button>' +
        (last ? '<button type="button" class="btn-submit"><span>Submit</span></button>' : '<button type="button" class="btn-next"><span>Next</span>' + ARROW + '</button>');
      if (state.step === 1) renderStep1();
      else if (!last) renderQuestions(error);
      else renderReview();
      nav.querySelector('.btn-back').addEventListener('click', function () {
        if (state.step > 1) {
          state.step--;
          render();
        }
      });
      var next = nav.querySelector('.btn-next');
      if (next) {
        next.addEventListener('click', function () {
          if (state.step === 2 && total === 3 && (!state.answers.q_auth || !state.answers.q_spon || !state.answers.q_years.trim())) {
            render('Please answer all required questions.');
            return;
          }
          state.step++;
          render();
        });
      }
      var submit = nav.querySelector('.btn-submit');
      if (submit) {
        submit.addEventListener('click', function () {
          state.submitClicks++;
          state.submitted = true;
          shell.innerHTML = '<div class="done"><h1>Application submitted</h1><p>You’ve successfully applied to ' + esc(company) + '.</p></div>';
          if (opts.onSubmit) opts.onSubmit(state);
        });
      }
    }

    render();
    return { state: state };
  }

  var api = { mountDiceWizard: mountDiceWizard };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mountDiceWizard = mountDiceWizard;
})(this);
