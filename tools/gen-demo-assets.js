'use strict';
/**
 * Gera as ilustrações SVG de demonstração (pratos, logos e capas) em public/assets/demo.
 * São arte original e genérica — não reproduzem marcas, logotipos nem personagens de terceiros.
 * Uso: node tools/gen-demo-assets.js
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'demo');
fs.mkdirSync(OUT, { recursive: true });

const svg = (w, h, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;

const bg = (c1, c2) => ({
  defs: `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".22"/></filter>`,
  rect: (w, h) => `<rect width="${w}" height="${h}" fill="url(#bg)"/>`,
});

/* --------------------------------------------------------------- pratos */
const dishes = {
  pizza: () => {
    let s = '<circle cx="200" cy="150" r="108" fill="#E8B05C" filter="url(#sh)"/><circle cx="200" cy="150" r="94" fill="#D9472B"/><circle cx="200" cy="150" r="88" fill="#F7D774"/>';
    const pep = [[160, 110], [230, 105], [200, 150], [150, 175], [245, 170], [205, 205], [165, 140], [240, 140], [190, 100]];
    pep.forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="15" fill="#B3261E"/><circle cx="${x - 4}" cy="${y - 4}" r="3" fill="#D8554B"/>`; });
    [[180, 125], [215, 185], [140, 150], [255, 120]].forEach(([x, y]) => { s += `<path d="M${x} ${y} q12 -16 24 0 q-12 14 -24 0z" fill="#3E8E41"/>`; });
    s += '<path d="M200 150 L200 56 M200 150 L295 150 M200 150 L133 216 M200 150 L105 150 M200 150 L267 84 M200 150 L267 216 M200 150 L133 84 M200 150 L200 244" stroke="#D9A24C" stroke-width="2.5" opacity=".65"/>';
    return s;
  },
  burger: () => `<ellipse cx="200" cy="248" rx="120" ry="16" fill="#000" opacity=".18"/>
<path d="M95 238 q0 24 30 24 h150 q30 0 30 -24z" fill="#E3A857"/>
<rect x="88" y="206" width="224" height="26" rx="13" fill="#6B3A2A"/>
<path d="M92 200 q20 -14 36 0 t36 0 t36 0 t36 0 t36 0 t30 0 v14 h-214z" fill="#6BBF59"/>
<rect x="96" y="186" width="208" height="18" rx="9" fill="#E5533D"/>
<path d="M98 176 h204 l-14 26 l-18 -14 l-20 22 l-22 -22 l-22 22 l-22 -22 l-18 14z" fill="#FFC83D"/>
<path d="M92 170 q0 -92 108 -92 q108 0 108 92z" fill="#E3A857" filter="url(#sh)"/>
<g fill="#FFF3D0"><ellipse cx="150" cy="118" rx="9" ry="4.5" transform="rotate(-20 150 118)"/><ellipse cx="200" cy="100" rx="9" ry="4.5"/><ellipse cx="250" cy="118" rx="9" ry="4.5" transform="rotate(20 250 118)"/><ellipse cx="180" cy="140" rx="9" ry="4.5" transform="rotate(-10 180 140)"/><ellipse cx="228" cy="142" rx="9" ry="4.5" transform="rotate(12 228 142)"/></g>`,
  sushi: () => {
    let s = '<rect x="50" y="70" width="300" height="170" rx="18" fill="#B98552" filter="url(#sh)"/><rect x="58" y="78" width="284" height="154" rx="12" fill="#CF9A63"/>';
    [[110, 130, '#F2733B'], [180, 130, '#7BC85A'], [250, 130, '#F2733B'], [145, 195, '#E94F5A'], [215, 195, '#F2C14E']].forEach(([x, y, c]) => {
      s += `<circle cx="${x}" cy="${y}" r="29" fill="#1E2A23"/><circle cx="${x}" cy="${y}" r="23" fill="#FFFDF5"/><circle cx="${x}" cy="${y}" r="10" fill="${c}"/>`;
    });
    s += '<ellipse cx="300" cy="190" rx="26" ry="14" fill="#FFFDF5"/><path d="M276 186 q24 -22 48 0 q-6 14 -24 14 q-18 0 -24 -14z" fill="#F2733B"/><circle cx="305" cy="110" r="14" fill="#6E4B2F"/><circle cx="305" cy="110" r="9" fill="#3A2616"/><ellipse cx="270" cy="105" rx="12" ry="8" fill="#9CCB3B"/>';
    return s;
  },
  pasta: () => {
    let s = '<circle cx="200" cy="150" r="112" fill="#FFFFFF" filter="url(#sh)"/><circle cx="200" cy="150" r="88" fill="#F3F0EA"/>';
    for (let i = 0; i < 9; i++) s += `<ellipse cx="200" cy="150" rx="${74 - i * 7}" ry="${60 - i * 6}" fill="none" stroke="#F2C45A" stroke-width="7" transform="rotate(${i * 17} 200 150)"/>`;
    s += '<circle cx="200" cy="144" r="26" fill="#C8372D"/><circle cx="190" cy="136" r="7" fill="#E4685B" opacity=".8"/>';
    [[165, 120], [238, 126], [222, 176], [170, 176]].forEach(([x, y]) => { s += `<path d="M${x} ${y} q10 -14 20 0 q-10 12 -20 0z" fill="#3E8E41"/>`; });
    return s;
  },
  acai: () => {
    let s = '<circle cx="200" cy="150" r="112" fill="#EDE3F7" filter="url(#sh)"/><circle cx="200" cy="150" r="98" fill="#4B1E78"/><circle cx="200" cy="150" r="86" fill="#6A2FA0"/>';
    [[150, 130], [175, 112], [200, 98]].forEach(([x, y]) => { s += `<ellipse cx="${x}" cy="${y}" rx="17" ry="17" fill="#FFE27A" stroke="#F5C84B" stroke-width="3"/>`; });
    [[245, 130], [225, 170], [165, 180]].forEach(([x, y]) => { s += `<path d="M${x} ${y - 16} q20 4 14 24 q-8 14 -14 14 q-6 0 -14 -14 q-6 -20 14 -24z" fill="#E4343F"/><path d="M${x - 5} ${y - 18} l5 -7 l5 7z" fill="#3E8E41"/>`; });
    for (let i = 0; i < 34; i++) { const a = i * 2.4; const r = 20 + (i % 6) * 9; s += `<circle cx="${200 + Math.cos(a) * r}" cy="${160 + Math.sin(a) * r * .7}" r="3.5" fill="#D7A24A"/>`; }
    return s;
  },
  cake: () => `<ellipse cx="200" cy="250" rx="140" ry="18" fill="#fff" filter="url(#sh)"/>
<path d="M90 238 L240 238 L300 192 L300 130 L150 130 L90 176z" fill="#8B4A2B"/>
<path d="M90 176 L240 176 L300 130 L150 130z" fill="#A25B35"/>
<path d="M90 176 L240 176 L240 238 L90 238z" fill="#6E3A21"/><path d="M240 176 L300 130 L300 192 L240 238z" fill="#5C2F1A"/>
<rect x="90" y="196" width="150" height="10" fill="#FFE8C7"/><path d="M240 196 L300 150 L300 160 L240 206z" fill="#F3D9AE"/>
<path d="M96 170 q10 22 22 0 q10 26 22 0 q10 18 22 0 q10 24 22 0 q10 16 22 0 L240 176 L90 176z" fill="#4A2412"/>
<circle cx="190" cy="124" r="16" fill="#C21F3A"/><path d="M190 110 q6 -22 22 -26" stroke="#3E8E41" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="184" cy="118" r="4" fill="#E86172"/>`,
  marmita: () => `<rect x="60" y="50" width="280" height="200" rx="22" fill="#E8E2D8" filter="url(#sh)"/><rect x="70" y="60" width="260" height="180" rx="16" fill="#F9F6F0"/>
<path d="M200 60 V240 M70 150 H200" stroke="#D9D2C5" stroke-width="3"/>
<g fill="#FFFFFF" stroke="#E6E0D3" stroke-width="2"><ellipse cx="135" cy="105" rx="52" ry="38"/></g>
<g fill="#FFFDF7">${Array.from({ length: 26 }, (_, i) => `<ellipse cx="${108 + (i % 7) * 9 + (i % 3) * 2}" cy="${86 + Math.floor(i / 7) * 10}" rx="4" ry="2.2" transform="rotate(${i * 23} 0 0)" opacity="0"/>`).join('')}</g>
<ellipse cx="135" cy="198" rx="52" ry="34" fill="#5A2E1A"/><g fill="#7A4326">${Array.from({ length: 16 }, (_, i) => `<ellipse cx="${100 + (i % 5) * 16}" cy="${182 + Math.floor(i / 5) * 12}" rx="6" ry="4"/>`).join('')}</g>
<path d="M222 90 q38 -22 80 6 q16 40 -20 56 q-48 4 -64 -30z" fill="#8A3F23"/><path d="M236 98 q30 -14 56 6" stroke="#B5633B" stroke-width="5" fill="none" stroke-linecap="round"/>
<ellipse cx="262" cy="196" rx="44" ry="34" fill="#DDF0C4"/><g>${[[238, 188, '#5DAE4A'], [262, 178, '#E5533D'], [284, 198, '#5DAE4A'], [252, 210, '#F2A93B'], [274, 214, '#E5533D']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="9" fill="${c}"/>`).join('')}</g>`,
  croissant: () => `<ellipse cx="200" cy="248" rx="140" ry="16" fill="#000" opacity=".16"/>
<g filter="url(#sh)"><ellipse cx="92" cy="196" rx="34" ry="22" transform="rotate(-48 92 196)" fill="#C98529"/><ellipse cx="308" cy="196" rx="34" ry="22" transform="rotate(48 308 196)" fill="#C98529"/>
<ellipse cx="138" cy="160" rx="48" ry="36" transform="rotate(-24 138 160)" fill="#DB9A3A"/><ellipse cx="262" cy="160" rx="48" ry="36" transform="rotate(24 262 160)" fill="#DB9A3A"/>
<ellipse cx="200" cy="140" rx="62" ry="46" fill="#E8AC4E"/></g>
<g fill="none" stroke="#B87420" stroke-width="4" stroke-linecap="round" opacity=".8"><path d="M168 106 q-14 30 -4 76"/><path d="M232 106 q14 30 4 76"/><path d="M112 130 q-14 22 -6 52"/><path d="M288 130 q14 22 6 52"/></g>
<g fill="none" stroke="#F6CE86" stroke-width="6" stroke-linecap="round" opacity=".85"><path d="M176 104 q24 -14 48 0"/><path d="M120 134 q12 -16 32 -22"/><path d="M280 134 q-12 -16 -32 -22"/></g>`,
  drink: () => `<ellipse cx="200" cy="262" rx="82" ry="12" fill="#000" opacity=".18"/>
<path d="M130 70 h140 l-18 190 q-2 12 -14 12 h-76 q-12 0 -14 -12z" fill="#FFFFFF" opacity=".55" filter="url(#sh)"/>
<path d="M138 110 h124 l-14 148 q-2 10 -12 10 h-72 q-10 0 -12 -10z" fill="#FF9F1C"/><path d="M138 110 h124 l-3 30 h-118z" fill="#FFB947"/>
<path d="M226 60 l22 -44" stroke="#E4343F" stroke-width="8" stroke-linecap="round"/>
<circle cx="150" cy="82" r="30" fill="#FF8A00"/><circle cx="150" cy="82" r="23" fill="#FFC15E"/><path d="M150 82 L150 59 M150 82 L170 71 M150 82 L170 93 M150 82 L150 105 M150 82 L130 93 M150 82 L130 71" stroke="#FF8A00" stroke-width="3"/>
<g fill="#fff" opacity=".6"><circle cx="170" cy="190" r="6"/><circle cx="200" cy="215" r="5"/><circle cx="225" cy="170" r="4"/></g>`,
  salad: () => {
    let s = '<circle cx="200" cy="150" r="112" fill="#F4F1EA" filter="url(#sh)"/><circle cx="200" cy="150" r="96" fill="#E6F2D8"/>';
    for (let i = 0; i < 14; i++) { const a = i * .9; const r = 20 + (i % 5) * 14; s += `<ellipse cx="${200 + Math.cos(a) * r}" cy="${150 + Math.sin(a) * r * .8}" rx="30" ry="13" fill="${['#4C9A3F', '#6BBF59', '#8BD17C'][i % 3]}" transform="rotate(${i * 40} ${200 + Math.cos(a) * r} ${150 + Math.sin(a) * r * .8})"/>`; }
    [[160, 120], [236, 130], [210, 190], [168, 182], [200, 130]].forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="13" fill="#E5382F"/><circle cx="${x - 4}" cy="${y - 4}" r="3.5" fill="#F27C74"/>`; });
    [[190, 160], [248, 168], [150, 156]].forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="11" fill="#CFE8A6" stroke="#8DBB4F" stroke-width="3"/>`; });
    return s;
  },
  fries: () => `<ellipse cx="200" cy="262" rx="100" ry="12" fill="#000" opacity=".18"/>
${Array.from({ length: 13 }, (_, i) => `<rect x="${118 + i * 12}" y="${60 + (i % 4) * 10}" width="11" height="150" rx="3" fill="${i % 2 ? '#F5C542' : '#FAD35E'}" transform="rotate(${(i - 6) * 4} ${124 + i * 12} 200)"/>`).join('')}
<path d="M110 168 h180 l-18 94 q-2 8 -10 8 h-124 q-8 0 -10 -8z" fill="#D8322B" filter="url(#sh)"/><path d="M110 168 h180 l-4 22 h-172z" fill="#E9524A"/><path d="M150 205 q50 -26 100 0 v26 q-50 -22 -100 0z" fill="#FFD9A0" opacity=".9"/>`,
  brigadeiro: () => {
    let s = '<ellipse cx="200" cy="245" rx="140" ry="16" fill="#000" opacity=".16"/>';
    [[110, 170], [200, 150], [290, 170], [155, 218], [245, 218]].forEach(([x, y], i) => {
      s += `<path d="M${x - 42} ${y} l10 -24 h64 l10 24 q-42 16 -84 0z" fill="${['#F0A4B8', '#8EC9E8', '#F4D06F', '#B8E0A0', '#D6A5E8'][i]}" filter="url(#sh)"/><circle cx="${x}" cy="${y - 22}" r="30" fill="#4A2412"/>`;
      for (let k = 0; k < 14; k++) s += `<rect x="${x - 26 + (k * 7) % 52}" y="${y - 44 + (k * 11) % 36}" width="7" height="2.6" rx="1.3" fill="${['#FFF', '#F2733B', '#FFD23F', '#6BBF59', '#E4343F'][k % 5]}" transform="rotate(${k * 31} ${x} ${y - 22})"/>`;
      s += `<ellipse cx="${x - 10}" cy="${y - 34}" rx="8" ry="4" fill="#fff" opacity=".18"/>`;
    });
    return s;
  },
  coffee: () => `<ellipse cx="200" cy="256" rx="120" ry="14" fill="#000" opacity=".16"/>
<ellipse cx="190" cy="220" rx="110" ry="30" fill="#fff" filter="url(#sh)"/>
<path d="M120 120 h140 v70 q0 44 -70 44 q-70 0 -70 -44z" fill="#FFFFFF" filter="url(#sh)"/><path d="M260 134 q52 -4 48 36 q-4 32 -50 28" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
<ellipse cx="190" cy="122" rx="70" ry="16" fill="#6B3A1E"/><ellipse cx="190" cy="120" rx="46" ry="9" fill="#C58A52"/><path d="M178 118 q12 -10 24 0 q-12 8 -24 0z" fill="#F6E3C9"/>
<path d="M165 90 q-10 -18 2 -34 M195 90 q-10 -18 2 -34 M225 90 q-10 -18 2 -34" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>`,
};

const palettes = {
  pizza: ['#FFD9A8', '#FF9F68'], burger: ['#FFE0B8', '#FFB36B'], sushi: ['#DFF1F0', '#9AD0CC'], pasta: ['#FFE9C4', '#F4B678'],
  acai: ['#F2E4FF', '#C79BEF'], cake: ['#FFE3EA', '#F7A9BD'], marmita: ['#FFF0D2', '#F7C77E'], croissant: ['#FFF1D6', '#F4C98B'],
  drink: ['#FFF1C9', '#FFC768'], salad: ['#E6F6D8', '#A9DB8A'], fries: ['#FFF1C9', '#FFC24D'], brigadeiro: ['#FFE6EE', '#F6B6C8'],
  coffee: ['#F5E6D6', '#D8AE82'],
};

for (const [name, draw] of Object.entries(dishes)) {
  const [c1, c2] = palettes[name];
  const b = bg(c1, c2);
  fs.writeFileSync(path.join(OUT, `dish-${name}.svg`), svg(400, 300, `${b.rect(400, 300)}${draw()}`, b.defs));
}

/* ----------------------------------------------- logos e capas por loja */
const stores = {
  forno: { c: ['#E8501C', '#B8340F'], dish: 'pizza', side: 'drink', mark: 'F' },
  brasa: { c: ['#7A3E1D', '#4B2410'], dish: 'burger', side: 'fries', mark: 'B' },
  koen: { c: ['#1F7A74', '#0F4B47'], dish: 'sushi', side: 'salad', mark: 'K' },
  nonna: { c: ['#B3261E', '#7D1712'], dish: 'pasta', side: 'salad', mark: 'N' },
  acai: { c: ['#6A2FA0', '#43186F'], dish: 'acai', side: 'drink', mark: 'A' },
  tempero: { c: ['#E0902B', '#A9610F'], dish: 'marmita', side: 'salad', mark: 'T' },
  pao: { c: ['#C77B30', '#8E5115'], dish: 'croissant', side: 'coffee', mark: 'P' },
  doce: { c: ['#D6537B', '#9F2B52'], dish: 'cake', side: 'brigadeiro', mark: 'D' },
};
for (const [key, s] of Object.entries(stores)) {
  const lb = bg(s.c[0], s.c[1]);
  fs.writeFileSync(path.join(OUT, `logo-${key}.svg`), svg(240, 240,
    `${lb.rect(240, 240)}<circle cx="190" cy="50" r="70" fill="#fff" opacity=".1"/><circle cx="40" cy="210" r="60" fill="#fff" opacity=".08"/>
<text x="120" y="156" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="120" font-weight="700" fill="#FFF8EC">${s.mark}</text>`, lb.defs));

  const cb = bg(s.c[0], s.c[1]);
  const [p1] = palettes[s.dish];
  const dish = dishes[s.dish]();
  fs.writeFileSync(path.join(OUT, `cover-${key}.svg`), svg(1200, 420,
    `${cb.rect(1200, 420)}
<circle cx="1050" cy="60" r="220" fill="#fff" opacity=".07"/><circle cx="120" cy="420" r="200" fill="#fff" opacity=".07"/><circle cx="640" cy="-40" r="130" fill="#fff" opacity=".05"/>
<g transform="translate(640 20) scale(1.35)"><rect x="0" y="0" width="0" height="0"/><g>${dish}</g></g>
<g transform="translate(120 110) scale(.62)" opacity=".95"><g>${dishes[s.side]()}</g></g>`,
    cb.defs + `<!-- ${p1} -->`));
}

console.log(`Ilustrações geradas em ${OUT}: ${fs.readdirSync(OUT).length} arquivos.`);
