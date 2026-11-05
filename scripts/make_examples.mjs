import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Packer, Paragraph, TextRun, LevelFormat, AlignmentType } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'docs/examples/example-master-resume.txt');
const lines = readFileSync(src, 'utf8').replace(/\r/g, '').split('\n');
const isHeading = (l) => /^[A-Z][A-Z &]{3,}$/.test(l.trim());

const children = lines.map((l, i) => {
  const t = l.trim();
  if (!t) return new Paragraph({ children: [] });
  if (t.startsWith('•')) return new Paragraph({ numbering: { reference: 'b', level: 0 }, children: [new TextRun({ text: t.replace(/^•\s*/, ''), size: 21 })] });
  if (i === 0) return new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 32 })] });
  if (isHeading(t)) return new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: t, bold: true, size: 22 })] });
  return new Paragraph({ children: [new TextRun({ text: t, size: 21 })] });
});
const doc = new Document({
  numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{ children }],
});
writeFileSync(resolve(root, 'docs/examples/example-master-resume.docx'), await Packer.toBuffer(doc));

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let page = pdf.addPage([612, 792]);
let y = 740;
const W = 612 - 108;
const wrap = (text, f, size) => {
  const out = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(next, size) > W) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
};
for (const [i, raw] of lines.entries()) {
  const t = raw.trim();
  if (!t) {
    y -= 6;
    continue;
  }
  const f = i === 0 || isHeading(t) ? bold : font;
  const size = i === 0 ? 16 : 10;
  for (const line of wrap(t, f, size)) {
    if (y < 60) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
    page.drawText(line, { x: 54, y, size, font: f });
    y -= size * 1.35;
  }
}
writeFileSync(resolve(root, 'docs/examples/example-master-resume.pdf'), await pdf.save());
console.log('wrote docs/examples/example-master-resume.docx and .pdf');

{
  const out = await PDFDocument.create();
  const reg = await out.embedFont(StandardFonts.Helvetica);
  const bd = await out.embedFont(StandardFonts.HelveticaBold);
  const L = 48, R = 612 - 48, TW = R - L - 14;
  let pg = out.addPage([612, 792]);
  let yy = 744;
  const need = (h) => {
    if (yy - h < 56) {
      pg = out.addPage([612, 792]);
      yy = 744;
    }
  };
  const text = (t, x, f, size) => pg.drawText(t, { x, y: yy, size, font: f });
  const right = (t, f, size) => text(t, R - f.widthOfTextAtSize(t, size), f, size);
  const wrapTo = (t, f, size, width) => {
    const res = [];
    let cur = '';
    for (const w of t.split(/\s+/)) {
      const n = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(n, size) > width) {
        res.push(cur);
        cur = w;
      } else cur = n;
    }
    if (cur) res.push(cur);
    return res;
  };
  const titleCase = (h) => h.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  let section = '';
  for (const [i, raw] of lines.entries()) {
    const t = raw.trim();
    if (!t) continue;
    if (i === 0) {
      text(t, L, bd, 18);
      yy -= 18;
      continue;
    }
    if (isHeading(t)) {
      section = t;
      need(30);
      yy -= 10;
      text(titleCase(t), L, bd, 12);
      pg.drawLine({ start: { x: L, y: yy - 4 }, end: { x: R, y: yy - 4 }, thickness: 0.6 });
      yy -= 18;
      continue;
    }
    if (section === 'EXPERIENCE' && t.includes('|') && /\d{4}/.test(t)) {
      const [title, company, place, dates] = t.split('|').map((s) => s.trim());
      need(40);
      yy -= 4;
      text(`${title}, ${company}`, L, bd, 10.5);
      right(dates, reg, 10);
      yy -= 13;
      right(place, reg, 10);
      yy -= 15;
      continue;
    }
    if (t.startsWith('•')) {
      const body = wrapTo(t.replace(/^•\s*/, ''), reg, 10, TW);
      need(13 * body.length + 2);
      pg.drawCircle({ x: L + 5, y: yy + 3.4, size: 1.6 });
      for (const ln of body) {
        text(ln, L + 14, reg, 10);
        yy -= 13;
      }
      continue;
    }
    for (const ln of wrapTo(t, reg, 10, R - L)) {
      need(13);
      text(ln, L, reg, 10);
      yy -= 13;
    }
  }
  writeFileSync(resolve(root, 'docs/examples/example-master-resume-flowcv-style.pdf'), await out.save({ useObjectStreams: false }));
}
console.log('FlowCV-style example PDF written');

{
  const out = await PDFDocument.create();
  const reg = await out.embedFont(StandardFonts.Helvetica);
  const bd = await out.embedFont(StandardFonts.HelveticaBold);
  const L = 42, C = 150, R = 612 - 42;
  let pg = out.addPage([595, 842]);
  let yy = 800;
  const need = (h) => {
    if (yy - h < 50) {
      pg = out.addPage([595, 842]);
      yy = 800;
    }
  };
  const text = (t, x, f, size) => pg.drawText(t, { x, y: yy, size, font: f });
  const wrapTo = (t, f, size, width) => {
    const res = [];
    let cur = '';
    for (const w of t.split(/\s+/)) {
      const n = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(n, size) > width) {
        res.push(cur);
        cur = w;
      } else cur = n;
    }
    if (cur) res.push(cur);
    return res;
  };
  const heading = (h) => {
    need(40);
    yy -= 14;
    text(h, (595 - bd.widthOfTextAtSize(h, 11)) / 2, bd, 11);
    yy -= 18;
  };
  const jobs = [
    { dates: '03/2022 – 08/2026', place: ['Austin, TX'], company: 'Lumenstream', title: 'Senior Video Player Engineer',
      about: ['Lead the cross-platform playback team for a subscription streaming service with millions of monthly viewers.'],
      bullets: [
        'Designed the Apple playback architecture using AVFoundation, AVPlayer, AVPlayerItem and AVPictureInPictureController.',
        'Migrated the Android player framework from ExoPlayer 2 to Android Media3 across phone, tablet and Android TV apps.',
        'Built adaptive bitrate (ABR) heuristics that reduced rebuffering by 18% using playback telemetry.',
        'Integrated Google IMA SDK, VAST 4.x and VMAP ad workflows for client-side ad insertion.',
      ],
      tech: 'Swift • Kotlin • AVFoundation • ExoPlayer • Android Media3 • HLS • LL-HLS • FairPlay • Widevine • Google IMA SDK • VAST • VMAP' },
    { dates: '06/2019 – 02/2022', place: ['Austin,', 'United States'], company: 'Signalwave Media', title: 'Video Streaming Engineer',
      about: ['Built live and on-demand streaming infrastructure for regional sports and news broadcasters.'],
      bullets: [
        'Designed live ingest pipelines supporting SRT, RTMP and MPEG-TS for 40 broadcast channels.',
        'Built Low-Latency HLS (LL-HLS), MPEG-DASH and CMAF packaging workflows with FFmpeg and GStreamer.',
        'Integrated AWS MediaLive, MediaPackage and MediaTailor into cloud broadcast workflows.',
        'Automated deployments using Docker, Kubernetes and Terraform.',
      ],
      tech: 'C++ • Python • FFmpeg • GStreamer • HLS • CMAF • MPEG-DASH • SRT • RTMP • AWS MediaLive • MediaPackage • MediaTailor • Docker • Kubernetes' },
    { dates: '01/2017 – 05/2019', place: ['Portland,', 'United States'], company: 'Northbeam Video Inc', title: 'Software Engineer',
      about: ['Developed components for an enterprise video delivery platform used by cable operators.'],
      bullets: [
        'Developed C++ services for video ingest, transcoding orchestration and media workflow automation.',
        'Built HLS and DASH packaging services for VOD and live streaming platforms.',
        'Integrated PostgreSQL, Redis and Elasticsearch into stream management systems.',
      ],
      tech: 'C++ • Linux • FFmpeg • MPEG-TS • HLS • DASH • Redis • PostgreSQL • Elasticsearch • Jenkins' },
    { dates: '07/2015 – 12/2016', place: ['Seoul, South Korea'], company: 'Hanbit Apps', title: 'Junior Backend Developer',
      about: ['Started my career building backend services and internal web tools.'],
      bullets: [
        'Developed RESTful APIs using Java and Spring Boot.',
        'Designed relational database schemas using PostgreSQL and MySQL.',
      ],
      tech: 'Java • Spring Boot • JavaScript • React • PostgreSQL • MySQL • REST APIs' },
  ];
  text('Jordan Lee', L, bd, 22);
  yy -= 18;
  text('Senior Software Engineer - Video Streaming', L, reg, 11);
  yy -= 16;
  text('jordan.lee@example.com', L, reg, 9.5);
  text('+1 512 555 0142', L + 150, reg, 9.5);
  text('Austin, TX', L + 260, reg, 9.5);
  yy -= 8;
  heading('PROFILE');
  for (const ln of wrapTo('Senior video player engineer with 11+ years of experience building OTT playback SDKs, live streaming pipelines and ad-supported video platforms across iOS, Android and connected TV.', reg, 10, R - L)) {
    text(ln, L, reg, 10);
    yy -= 13;
  }
  heading('PROFESSIONAL EXPERIENCE');
  for (const j of jobs) {
    need(60);
    yy -= 6;
    text(j.dates, L, reg, 9.5);
    text(j.company, C, bd, 10.5);
    yy -= 13;
    text(j.place[0], L, reg, 9.5);
    text(j.title, C, reg, 10.5);
    yy -= 13;
    let side = 1;
    for (const p of j.about) {
      for (const ln of wrapTo(p, reg, 10, R - C)) {
        need(13);
        if (side < j.place.length) text(j.place[side++], L, reg, 9.5);
        text(ln, C, reg, 10);
        yy -= 13;
      }
    }
    for (const b of j.bullets) {
      const body = wrapTo(b, reg, 10, R - C - 12);
      need(13 * body.length + 4);
      pg.drawText('•', { x: C + 2, y: yy - 2.5, size: 10, font: reg });
      for (const ln of body) {
        text(ln, C + 12, reg, 10);
        yy -= 13;
      }
      yy -= 2;
    }
    need(40);
    text('Technologies', C, bd, 10);
    yy -= 13;
    for (const ln of wrapTo(j.tech, reg, 9.5, R - C)) {
      text(ln, C, reg, 9.5);
      yy -= 12;
    }
    yy -= 6;
  }
  heading('EDUCATION');
  text('09/2011 – 06/2015', L, reg, 9.5);
  text("Bachelor's degree / Computer Science", C, bd, 10.5);
  yy -= 13;
  text('Seattle, WA', L, reg, 9.5);
  text('University of Washington', C, reg, 10.5);
  yy -= 13;
  heading('SKILLS');
  const cols = [
    ['Video Streaming', '•Live Streaming', '•Video on Demand (VOD)', '•OTT Platforms', '•Low-Latency HLS', '•DRM', '•Widevine', '•FairPlay', 'Programming Languages', '•C++', '•Kotlin', '•Swift', '•Java', '•Python'],
    ['Video Players', '•HLS.js', '•ExoPlayer', '•AVPlayer', '•Shaka Player', '•Video.js', 'Streaming Infrastructure', '•FFmpeg', '•GStreamer', '•AWS MediaLive', '•SRT', '•RTMP'],
    ['Advertising Technology', '•Google Ad Manager', '•OpenRTB', '•VAST 2.x–4.x', '•VMAP', '•SSAI', 'Cloud & DevOps', '•AWS', '•Docker', '•Kubernetes', '•Terraform', '•Prometheus'],
  ];
  const xs = [L, L + 175, L + 350];
  const rows = Math.max(...cols.map((c) => c.length));
  for (let r = 0; r < rows; r++) {
    need(13);
    cols.forEach((c, ci) => {
      const t = c[r];
      if (!t) return;
      if (t.startsWith('•')) {
        pg.drawText('•', { x: xs[ci], y: yy - 2.5, size: 10, font: reg });
        text(t.slice(1), xs[ci] + 8, reg, 10);
      } else text(t, xs[ci], bd, 10);
    });
    yy -= 13;
  }
  writeFileSync(resolve(root, 'docs/examples/example-master-resume-two-column.pdf'), await out.save({ useObjectStreams: false }));
}
console.log('Two-column example PDF written');
