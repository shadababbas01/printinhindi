// Extracted verbatim from hindi-registry-tool-phase1.html (Kruti Dev / Devlys
// conversion + Devanagari mark normalization). This is the most fragile,
// highest-value-to-regress logic in the whole app — see
// apps/web/BASELINE_hindi-registry-tool-phase1.html for the untouched
// reference copy and tests/unit/legacy-font.test.js for the regression suite
// that pins its current behavior before any further refactor.

  // (they're overloaded keys on the real Kruti Dev keyboard). Indian legal/
  // revenue documents are full of survey numbers and dates that use exactly
  // these characters as plain punctuation (e.g. "106/115", "(6-17)",
  // "01-12-2025"). Those six are pulled out of this bulk table and handled by
  // applyAmbiguousPunctuation() below instead, which only converts them to
  // the Devanagari glyph when they're NOT touching a digit — so citations stay
  // literal but mid-word uses (e.g. ":ह" -> "रूह") still convert correctly.
  // ';' is kept in the bulk table since on Kruti Dev it's the primary key for
  // the consonant "य" (ya), not decorative punctuation.
  const KD_ARRAY_ONE = [
    "ñ", "Q+Z", "sas", "aa", ")Z", "ZZ", "‘", "’", "“", "”", "å", "ƒ", "„", "…", "†", "‡", "ˆ", "‰", "Š", "‹", "¶+", 
    "d+", "[+k", "[+", "x+", "T+", "t+", "M+", "<+", "Q+", ";+", "j+", "u+", "Ùk", "Ù", "ä", "–", "—", "é", "™", 
    "=kk", "f=k", "à", "á", "â", "ã", "ºz", "º", "í", "{k", "{", "=", "«", "Nî", "Vî", "Bî", "Mî", "<î", "|", "K", 
    "}", "J", "Vª", "Mª", "<ªª", "Nª", "Ø", "Ý", "nzZ", "æ", "ç", "Á", "xz", "#", "v‚", "vks", "vkS", "vk", "v", "b±", 
    "Ã", "bZ", "b", "m", "Å", ",s", ",", "_", "ô", "d", "Dk", "D", "[k", "[", "x", "Xk", "X", "Ä", "?k", "?", "³", 
    "pkS", "p", "Pk", "P", "N", "t", "Tk", "T", ">", "÷", "¥", "ê", "ë", "V", "B", "ì", "ï", "M+", "<+", "M", "<", 
    ".k", "r", "Rk", "R", "Fk", "F", "n", "/k", "èk", "Ë", "è", "u", "Uk", "U", "i", "Ik", "I", "Q", "¶", "c", "Ck", 
    "C", "Hk", "H", "e", "Ek", "E", ";", "¸", "j", "y", "Yk", "Y", "G", "o", "Ok", "O", "'k", "'", "\"k", "\"", "l", 
    "Lk", "L", "g", "È", "z", "Ì", "Í", "Î", "Ï", "Ñ", "Ò", "Ó", "Ô", "Ö", "Ø", "Ù", "Ük", "Ü", "‚", "ks", "kS", "k", 
    "h", "q", "w", "`", "s", "S", "a", "¡", "%", "W", "•", "·", "∙", "·", "~j", "~", "\\", "+", " ः", "^", "*", "Þ", 
    "ß", "¼", "½", "¿", "À", "¾", "A", "&", "&", "Œ", "]", "~ ", "@" 
  ];
  const KD_ARRAY_TWO = [
    "॰", "QZ+", "sa", "a", "र्द्ध", "Z", "\"", "\"", "'", "'", "०", "१", "२", "३", "४", "५", "६", "७", "८", "९", "फ़्", 
    "क़", "ख़", "ख़्", "ग़", "ज़्", "ज़", "ड़", "ढ़", "फ़", "य़", "ऱ", "ऩ", "त्त", "त्त्", "क्त", "दृ", "कृ", "न्न", "न्न्", 
    "=k", "f=", "ह्न", "ह्य", "हृ", "ह्म", "ह्र", "ह्", "द्द", "क्ष", "क्ष्", "त्र", "त्र्", "छ्य", "ट्य", "ठ्य", 
    "ड्य", "ढ्य", "द्य", "ज्ञ", "द्व", "श्र", "ट्र", "ड्र", "ढ्र", "छ्र", "क्र", "फ्र", "र्द्र", "द्र", "प्र", "प्र", 
    "ग्र", "रु", "ऑ", "ओ", "औ", "आ", "अ", "ईं", "ई", "ई", "इ", "उ", "ऊ", "ऐ", "ए", "ऋ", "क्क", "क", "क", "क्", "ख", 
    "ख्", "ग", "ग", "ग्", "घ", "घ", "घ्", "ङ", "चै", "च", "च", "च्", "छ", "ज", "ज", "ज्", "झ", "झ्", "ञ", "ट्ट", 
    "ट्ठ", "ट", "ठ", "ड्ड", "ड्ढ", "ड़", "ढ़", "ड", "ढ", "ण", "त", "त", "त्", "थ", "थ्", "द", "ध", "ध", "ध्", "ध्", 
    "न", "न", "न्", "प", "प", "प्", "फ", "फ्", "ब", "ब", "ब्", "भ", "भ्", "म", "म", "म्", "य", "य्", "र", "ल", "ल", 
    "ल्", "ळ", "व", "व", "व्", "श", "श्", "ष", "ष्", "स", "स", "स्", "ह", "ीं", "्र", "द्द", "ट्ट", "ट्ठ", "ड्ड", 
    "कृ", "भ", "्य", "ड्ढ", "झ्", "क्र", "त्त्", "श", "श्", "ॉ", "ो", "ौ", "ा", "ी", "ु", "ू", "ृ", "े", "ै", "ं", 
    "ँ", "ः", "ॅ", "ऽ", "ऽ", "ऽ", "ऽ", "्र", "्", "?", "़", ":", "‘", "’", "“", "”", "(", ")", "{", "}", "=", "।", 
    "-", "µ", "॰", ",", "् ", "/" 
  ];

  const KD_TEST_STRINGS = ['Hkkjr','jkT;','U;kfn','laifRr','iath','ljdkj','ftyk','rglhy','izkFkZuk','vkosnu'];

  // ( ) - / . : are ambiguous on the real Kruti Dev keyboard: sometimes literal
  // punctuation (survey numbers, dates), sometimes the primary key for a
  // Devanagari glyph. Only apply the glyph mapping when NOT touching a digit —
  // that reliably tells apart "106/115" (leave alone) from a mid-word use like
  // ":ह" -> "रूह" (a common legal-deed phrase meaning "by virtue of").
  const AMBIGUOUS_PUNCT = [[':', 'रू'], ['.', 'ण्'], [')', 'द्ध'], ['/', 'ध्'], ['(', ';'], ['-', '.']];
  function applyAmbiguousPunctuation(text){
    AMBIGUOUS_PUNCT.forEach(([from, to]) => {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('(?<![0-9])' + escaped + '(?![0-9])', 'g'), to);
    });
    return text;
  }

  function krutiDevReplaceSymbols(input){
    let s = input;
    for (let i = 0; i < KD_ARRAY_ONE.length; i++) {
      if (s.indexOf(KD_ARRAY_ONE[i]) !== -1) {
        s = s.split(KD_ARRAY_ONE[i]).join(KD_ARRAY_TWO[i]);
      }
    }
    s = applyAmbiguousPunctuation(s);

    // Special multi-byte glyphs (reph+anusvar, embedded i-matra forms, etc.)
    s = s.split('±').join('Zं');
    s = s.split('Æ').join('र्f');

    // 'f' represents the ि matra but is typed BEFORE its consonant; move it
    // to just after the following character.
    let posF = s.indexOf('f');
    while (posF !== -1) {
      const nextChar = s.charAt(posF + 1);
      s = s.replace('f' + nextChar, nextChar + 'ि');
      posF = s.indexOf('f');
    }

    // 'fa' -> 'िं' (matra + anusvar combo typed before the consonant)
    s = s.split('Ç').join('fa');
    s = s.split('É').join('र्fa');
    let posFa = s.indexOf('fa');
    while (posFa !== -1) {
      const nextChar = s.charAt(posFa + 2);
      s = s.replace('fa' + nextChar, nextChar + 'िं');
      posFa = s.indexOf('fa');
    }

    s = s.split('Ê').join('ीZ');

    // Fix 'ि्' produced by the reorder above landing on a half-consonant.
    let posWrongEe = s.indexOf('ि्');
    while (posWrongEe !== -1) {
      const consonantAfter = s.charAt(posWrongEe + 2);
      s = s.replace('ि्' + consonantAfter, '्' + consonantAfter + 'ि');
      posWrongEe = s.indexOf('ि्');
    }

    // 'Z' represents reph (र्) but is typed AFTER the consonant cluster it
    // attaches to; walk left across any matras to find the cluster start,
    // then move र् in front of it.
    const matras = 'अ आ इ ई उ ऊ ए ऐ ओ औ ा ि ी ु ू ृ े ै ो ौ ं : ँ ॅ';
    let posZ = s.indexOf('Z');
    while (posZ > 0) {
      let start = posZ - 1;
      while (start >= 0 && matras.indexOf(s.charAt(start)) !== -1) start--;
      const clusterStart = start < 0 ? 0 : start; // start now points AT the consonant (inclusive)
      const cluster = s.substring(clusterStart, posZ);
      s = s.replace(cluster + 'Z', 'र्' + cluster);
      posZ = s.indexOf('Z');
    }

    return s;
  }

  function convertLegacyText(text, mapType){
    if (!text) return text;
    // Devlys 010 shares the vast majority of its glyph layout with Kruti Dev
    // 010; until a separately-verified Devlys table is available, both use
    // this Kruti Dev conversion.
    return krutiDevReplaceSymbols(text);
  }

  // Applies legacy conversion to TEXT NODES ONLY inside an HTML string, preserving tags.
  function convertLegacyHTML(html, mapType, callback){
    const container = document.createElement('div');
    container.innerHTML = html;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    let idx = 0;
    function processChunk(){
      const start = performance.now();
      while (idx < textNodes.length && performance.now() - start < 12) {
        textNodes[idx].nodeValue = convertLegacyText(textNodes[idx].nodeValue, mapType);
        idx++;
      }
      if (idx < textNodes.length) {
        setTimeout(processChunk, 0);
      } else {
        callback(container.innerHTML);
      }
    }
    processChunk();
  }

  function detectLegacyFont(html){
    const plainText = html.replace(/<[^>]+>/g, '');
    const devanagariChars = (plainText.match(/[ऀ-ॿ]/g) || []).length;
    const latinChars = (plainText.match(/[a-zA-Z]/g) || []).length;
    const totalAlpha = devanagariChars + latinChars;
    if (totalAlpha === 0) return { detected: false };
    const latinRatio = latinChars / totalAlpha;
    if (latinRatio > 0.7 && latinChars > 50) {
      const patternMatches = KD_TEST_STRINGS.filter(p => plainText.indexOf(p) !== -1).length;
      return {
        detected: true,
        confidence: patternMatches >= 2 ? 'high' : 'medium',
        latinRatio: latinRatio,
        patternMatches: patternMatches
      };
    }
    return { detected: false };
  }

  // A dependent Devanagari mark (matra, nukta, anusvar/chandrabindu/visarga)
  // that isn't sitting on a valid base renders as a broken dotted circle or
  // ends up in the wrong position — visible as odd gaps or stray marks. These
  // three passes clean that up without touching already-correct text (every
  // one is a no-op on text where the marks are already properly placed).
  const DEVA_BASE = /[ऄ-हक़-ॡॲ-ॿऽॐ]/;   // consonants + independent vowels
  const DEVA_MATRA = /[ा-ौॎॏॕ-ॗॢॣ]/;    // dependent vowel signs
  const DEVA_ANUSVAR = /[ऀ-ः]/;          // candrabindu, anusvara, visarga
  const DEVA_NUKTA = '़';

  function dropOrphanedNukta(text){
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === DEVA_NUKTA && !DEVA_BASE.test(out[out.length - 1] || '')) continue;
      out += ch;
    }
    return out;
  }

  function dropOrphanedMarks(text){
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const prev = out[out.length - 1] || '';
      if (DEVA_MATRA.test(ch)) {
        if (!DEVA_BASE.test(prev)) continue; // matra must sit directly on a consonant/vowel
      } else if (DEVA_ANUSVAR.test(ch)) {
        // anusvar/chandrabindu/visarga may follow a bare consonant OR a matra (e.g. "हैं")
        if (!DEVA_BASE.test(prev) && !DEVA_MATRA.test(prev)) continue;
      }
      out += ch;
    }
    return out;
  }

  function normalizeDevanagariText(text){
    if (!text) return text;
    // Orphaned nukta must be cleared FIRST — it often sits between an anusvar
    // and the matra it needs to swap with next, blocking that match.
    text = dropOrphanedNukta(text);
    // A vowel matra must come BEFORE anusvar/chandrabindu/visarga in Unicode
    // order (they visually combine either way, but wrong order renders as two
    // separate marks with an odd gap between them instead of one glyph).
    text = text.replace(/([ंँः])([ािीुूृेैोौ])/g, '$2$1');
    // Anything still orphaned at this point (stray marks with no real word
    // to attach to) gets dropped rather than rendering as a broken glyph.
    return dropOrphanedMarks(text);
  }

export {
  KD_ARRAY_ONE,
  KD_ARRAY_TWO,
  KD_TEST_STRINGS,
  krutiDevReplaceSymbols,
  applyAmbiguousPunctuation,
  convertLegacyText,
  detectLegacyFont,
  normalizeDevanagariText,
};
