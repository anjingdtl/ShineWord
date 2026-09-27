// Deterministic CI-safe extractor used to exercise the world build pipeline
// without an LLM. It discovers facts from the sentence patterns the fixture
// novels use, resolves subjects (explicit names, pronouns via last subject),
// and computes absolute code point offsets so evidence validation can verify
// every quote against the immutable source.
'use strict';

const { codePointLength } = require('../../dist/domain/world/textOffsets');

const TIERS = ['后天', '先天', '宗师'];
const RANK_TITLES = ['掌门', '副掌门', '首席长老', '执法长老', '长老', '教主'];

function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '。' || ch === '！' || ch === '？') {
      sentences.push({ text: text.slice(start, i + 1), relStart: start });
      start = i + 1;
    }
  }
  if (start < text.length) {
    sentences.push({ text: text.slice(start), relStart: start });
  }
  return sentences;
}

function splitClauses(sentenceText) {
  const clauses = [];
  let start = 0;
  for (let i = 0; i < sentenceText.length; i += 1) {
    const ch = sentenceText[i];
    if (ch === '，' || ch === '；' || ch === '。' || ch === '！' || ch === '？') {
      const clause = sentenceText.slice(start, i + 1);
      if (clause.trim()) clauses.push(clause);
      start = i + 1;
    }
  }
  const tail = sentenceText.slice(start);
  if (tail.trim()) clauses.push(tail);
  return clauses;
}

function captureAfterDe(raw) {
  const at = raw.lastIndexOf('的');
  return at === -1 ? raw : raw.slice(at + 1);
}

class FixtureExtractor {
  constructor({ knownNames, failChunkIds = [] }) {
    this.version = 'fixture-extractor-1';
    this.knownNames = [...knownNames].sort((a, b) => b.length - a.length);
    this.failChunkIds = new Set(failChunkIds);
    this.calls = 0;
  }

  firstKnownName(text) {
    let best = null;
    let bestIndex = Number.MAX_SAFE_INTEGER;
    for (const name of this.knownNames) {
      const at = text.indexOf(name);
      if (at !== -1 && (at < bestIndex || (at === bestIndex && best && name.length > best.length))) {
        best = name;
        bestIndex = at;
      }
    }
    return best;
  }

  async extract({ chunk, chunkText }) {
    this.calls += 1;
    if (this.failChunkIds.has(chunk.chunkId)) {
      throw new Error(`simulated extractor failure for ${chunk.chunkId}`);
    }

    const facts = [];
    const subjects = new Set();
    let lastSubject = null;

    const emit = (subject, predicate, value, quote) => {
      subjects.add(subject);
      const relStart = quote.relStart;
      const cpStart = chunk.startOffset + relStart;
      const cpLength = codePointLength(quote.text);
      facts.push({
        subjectKey: subject,
        predicate,
        value,
        status: 'explicit',
        confidence: 1.0,
        evidence: {
          chapterId: chunk.chapterId,
          startOffset: cpStart,
          endOffset: cpStart + cpLength,
          quote: quote.text,
        },
      });
    };

    for (const sentence of splitSentences(chunkText)) {
      // Pronoun substitution for MATCHING only; evidence quotes always come
      // from the original sentence text so spans stay verbatim in the source.
      let effective = sentence.text;
      if (lastSubject) {
        effective = effective
          .replace(/他|她|它/g, lastSubject)
          .replace(new RegExp(`${lastSubject}{2,}`, 'g'), lastSubject);
      }
      const sentenceSubject = this.firstKnownName(effective) || lastSubject;

      const originalClauses = splitClauses(sentence.text);
      const effectiveClauses = splitClauses(effective);
      let cursor = 0;
      const originalSpans = originalClauses.map(clause => {
        const relInSentence = sentence.text.indexOf(clause, cursor);
        cursor = relInSentence + clause.length;
        return { text: clause, relStart: sentence.relStart + relInSentence };
      });

      for (let i = 0; i < effectiveClauses.length; i += 1) {
        const clause = effectiveClauses[i];
        const quote = originalSpans[i] ?? { text: sentence.text, relStart: sentence.relStart };
        const pick = (captured) => {
          if (captured && this.knownNames.includes(captured)) return captured;
          if (captured && /^[他她它自己]+$/.test(captured) && lastSubject) return lastSubject;
          return sentenceSubject || lastSubject;
        };

        // skills: "X擅长A和B" then single "X擅长A"
        let m = clause.match(/([\u4e00-\u9fa5]{2,4})擅长([\u4e00-\u9fa5]{2,4})和([\u4e00-\u9fa5]{2,4})/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'skill', { skill: m[2] }, quote);
          emit(pick(m[1]), 'skill', { skill: m[3] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }
        m = clause.match(/([\u4e00-\u9fa5]{2,4})擅长([\u4e00-\u9fa5]{2,4})(?:和|$|，)/) ||
            clause.match(/([\u4e00-\u9fa5]{2,4})擅长([\u4e00-\u9fa5]{2,4})/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'skill', { skill: m[2] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // item: "X持有一件/把/枚/支Y"
        m = clause.match(/([\u4e00-\u9fa5]{0,4})持有一[件把枚支]([\u4e00-\u9fa5]{2,6})/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'owns_item', { item: m[2] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // home: "X居住在Y"
        m = clause.match(/([\u4e00-\u9fa5]{2,4})居住在([\u4e00-\u9fa5]{2,12})/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'home_location', { location: captureAfterDe(m[2]) }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // tier: "(X的/知道)A已达/也已臻T境界"
        m = clause.match(/([\u4e00-\u9fa5]{2,3})(?:已达|也已臻)([\u4e00-\u9fa5]{1,3})境界/);
        if (m && pick(null) && TIERS.includes(m[2])) {
          emit(pick(null), 'ability_tier', { skill: m[1].replace(/^的+/, ''), tier: m[2] }, quote);
          lastSubject = pick(null);
          continue;
        }

        // master: "X师从(长老|师父|掌门)?Y" with optional leading name
        m = clause.match(/(?:([\u4e00-\u9fa5]{2,4}))?师从(?:长老|师父|掌门)?([\u4e00-\u9fa5]{2,4})/);
        if (m && pick(m[1]) && m[2] && this.knownNames.includes(m[2])) {
          emit(pick(m[1]), 'master', { person: m[2] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // relationship: "X与Y是R"
        m = clause.match(/([\u4e00-\u9fa5]{2,4})与([\u4e00-\u9fa5]{2,4})是(挚友|宿敌|同门|师徒)/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'relationship', { person: m[2], relation: m[3] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // goal: "X想要在论剑大会上夺取魁首"
        m = clause.match(/([\u4e00-\u9fa5]{2,4})想要在论剑大会上(夺取魁首)/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'goal', { goal: m[2] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // current location: "X来到Y" / "X走进了Y"
        m = clause.match(/([\u4e00-\u9fa5]{0,4})(?:来到|走进了)([\u4e00-\u9fa5]{2,12})/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'current_location', { location: captureAfterDe(m[2]) }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // faction: "X效忠于Y" / "X(其实)是Y的弟子" / "X其实是Y的人"
        m = clause.match(/([\u4e00-\u9fa5]{2,4})效忠于([\u4e00-\u9fa5]{2,6})/) ||
            clause.match(/([\u4e00-\u9fa5]{2,4})(?:是|其实是)([\u4e00-\u9fa5]{2,6})的(?:外门|内门|亲传)?弟子/) ||
            clause.match(/([\u4e00-\u9fa5]{2,4})其实是([\u4e00-\u9fa5]{2,6})的人/);
        if (m && pick(m[1])) {
          emit(pick(m[1]), 'faction_member', { faction: m[2] }, quote);
          lastSubject = pick(m[1]);
          continue;
        }

        // rank continuation: "在(门|派|教)中担任Z" / "是教中的Z"
        m = clause.match(/在[\u4e00-\u9fa5]{0,6}担任([\u4e00-\u9fa5]{2,6})/) ||
            clause.match(/是教中的([\u4e00-\u9fa5]{2,6})/);
        if (m && (sentenceSubject || lastSubject)) {
          emit(sentenceSubject || lastSubject, 'rank', { rank: m[1] }, quote);
          continue;
        }

        // rank via title prefix: "教主炎无极" (skip honorifics after 师从)
        let titled = false;
        if (!clause.includes('师从')) {
          for (const title of RANK_TITLES) {
            for (const name of this.knownNames) {
              if (clause.includes(title + name)) {
                emit(name, 'rank', { rank: title }, quote);
                lastSubject = name;
                titled = true;
              }
            }
          }
        }
        if (titled) continue;
      }

      const explicitSubject = this.firstKnownName(sentence.text);
      if (explicitSubject) lastSubject = explicitSubject;
    }

    // Events.
    const events = [];
    for (const sentence of splitSentences(chunkText)) {
      if (sentence.text.includes('论剑大会将在白帝城召开')) {
        events.push({
          eventKey: 'lunjian-announced',
          title: '论剑大会宣布',
          summary: '江湖传言论剑大会将在白帝城召开。',
          worldTimeOrder: 1,
          narrativeChapterId: chunk.chapterId,
          dependsOnEventKeys: [],
        });
      }
      if (sentence.text.includes('论剑大会终于开幕')) {
        events.push({
          eventKey: 'lunjian-started',
          title: '论剑大会开幕',
          summary: '论剑大会在白帝城开幕。',
          worldTimeOrder: 2,
          narrativeChapterId: chunk.chapterId,
          dependsOnEventKeys: ['lunjian-announced'],
        });
      }
    }

    // Entities: characters that produced facts, plus names mentioned in text.
    const entityKeys = new Set(subjects);
    for (const name of this.knownNames) {
      if (chunkText.includes(name)) entityKeys.add(name);
    }
    const entities = [...entityKeys].map(name => ({ entityKey: name, type: 'character', name }));

    return { entities, facts, events, ruleMappings: [] };
  }
}

module.exports = { FixtureExtractor };
