// Deterministic generator for the medium fixture novel (~20k chars, 30 chapters).
// Emits novel-medium.txt and facts-medium.json with fact annotations whose
// quotes are guaranteed to appear verbatim in the novel.
'use strict';

const fs = require('fs');
const path = require('path');

const SURNAMES = ['苏', '沈', '陆', '叶', '秦', '林', '楚', '洛', '萧', '孟', '白', '江'];
const GIVEN = ['明轩', '若雪', '惊鸿', '清歌', '寒山', '望舒', '凌波', '听雨', '照夜', '流云', '慕青', '知远'];
const SECTS = ['天枢阁', '沧海门', '赤霄盟', '幽篁谷', '凌霄殿', '百川会'];
const RANKS = ['掌门', '副掌门', '首席长老', '执法长老', '巡山弟子', '外门弟子'];
const SKILLS = ['剑术', '轻功', '毒术', '医术', '琴艺', '棋艺', '追踪术', '易容术', '御风诀', '寒冰掌'];
const TIERS = ['后天', '先天', '宗师'];
const ITEMS = ['寒光剑', '碧玉箫', '千机匣', '软猬甲', '踏云靴', '凝露瓶', '碎星弓', '无相佩'];
const LOCATIONS = ['听潮崖', '落星湖', '孤鸿岭', '栖霞渡', '断云峡', '白帝城', '青竹坞', '望江楼'];
const RELATIONS = ['挚友', '宿敌', '同门'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260927);
function pick(list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

const characters = [];
const usedNames = new Set();
for (let i = 0; i < 28; i += 1) {
  let name = pick(SURNAMES) + pick(GIVEN);
  while (usedNames.has(name)) name = pick(SURNAMES) + pick(GIVEN);
  usedNames.add(name);
  characters.push({
    name,
    sect: SECTS[i % SECTS.length],
    rank: RANKS[(i + Math.floor(rand() * RANKS.length)) % RANKS.length],
    master: null,
    skillA: SKILLS[(i * 3) % SKILLS.length],
    skillB: SKILLS[(i * 3 + 5) % SKILLS.length],
    tier: TIERS[i % TIERS.length],
    item: ITEMS[i % ITEMS.length],
    home: LOCATIONS[i % LOCATIONS.length],
    visit: LOCATIONS[(i + 3) % LOCATIONS.length],
  });
}
// The last 14 characters are juniors with masters from the first 14.
for (let i = 14; i < characters.length; i += 1) {
  characters[i].master = characters[i - 14].name;
}

const facts = [];
function addFact(fact) { facts.push(fact); }

function factSentences(c) {
  const out = [];
  out.push(`${c.name}效忠于${c.sect}，在门中担任${c.rank}。`);
  addFact({ subject: c.name, predicate: 'faction_member', value: { faction: c.sect }, quote: `${c.name}效忠于${c.sect}` });
  addFact({ subject: c.name, predicate: 'rank', value: { rank: c.rank }, quote: `在门中担任${c.rank}`, subjectFromPrevious: c.name });
  out.push(`${c.name}擅长${c.skillA}和${c.skillB}，同辈之中少有人及。`);
  addFact({ subject: c.name, predicate: 'skill', value: { skill: c.skillA }, quote: `${c.name}擅长${c.skillA}` });
  addFact({ subject: c.name, predicate: 'skill', value: { skill: c.skillB }, quote: `${c.skillB}，同辈之中少有人及`, subjectFromPrevious: c.name });
  out.push(`${c.name}持有一件${c.item}，那是他多年以前在${c.home}所得。`);
  addFact({ subject: c.name, predicate: 'owns_item', value: { item: c.item }, quote: `${c.name}持有一件${c.item}` });
  out.push(`${c.name}居住在${c.home}，平日里深居简出。`);
  addFact({ subject: c.name, predicate: 'home_location', value: { location: c.home }, quote: `${c.name}居住在${c.home}` });
  if (c.master) {
    out.push(`${c.name}师从${c.master}，尽得其真传。`);
    addFact({ subject: c.name, predicate: 'master', value: { person: c.master }, quote: `${c.name}师从${c.master}` });
  } else {
    out.push(`江湖传言，${c.name}的${c.skillA}已达${c.tier}境界。`);
    addFact({ subject: c.name, predicate: 'ability_tier', value: { skill: c.skillA, tier: c.tier }, quote: `${c.name}的${c.skillA}已达${c.tier}境界`, subjectInsideQuote: c.name });
  }
  return out;
}

function cycleSentences(c) {
  const out = [];
  out.push(`这一日，${c.name}来到${c.visit}，参加论剑大会的预选。`);
  addFact({ subject: c.name, predicate: 'current_location', value: { location: c.visit }, quote: `${c.name}来到${c.visit}` });
  const idx = characters.indexOf(c);
  const other = characters[(idx + 9) % characters.length];
  if (other.name !== c.name) {
    const relation = RELATIONS[idx % RELATIONS.length];
    out.push(`${c.name}与${other.name}是${relation}，彼此知根知底。`);
    addFact({ subject: c.name, predicate: 'relationship', value: { person: other.name, relation }, quote: `${c.name}与${other.name}是${relation}` });
  }
  out.push(`众人皆知，${c.name}的${c.skillB}也已臻${c.tier}境界。`);
  addFact({ subject: c.name, predicate: 'ability_tier', value: { skill: c.skillB, tier: c.tier }, quote: `${c.name}的${c.skillB}也已臻${c.tier}境界`, subjectInsideQuote: c.name });
  return out;
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十'];

const chapters = [];
for (let chapterIndex = 1; chapterIndex <= 30; chapterIndex += 1) {
  const lines = [`第${CN_NUM[chapterIndex - 1]}章 江湖行${chapterIndex}`, ''];

  if (chapterIndex === 1) {
    lines.push('北风起，江湖传言论剑大会将在白帝城召开，各路豪杰闻风而动。');
  } else if (chapterIndex === 15) {
    lines.push('论剑大会的战书传遍天下，白帝城内暗流涌动，各方势力各怀心事。');
  } else if (chapterIndex === 30) {
    lines.push('论剑大会终于开幕，白帝城头剑气纵横，多年的恩怨情仇都将在此了结。');
  } else {
    lines.push(`这一日江湖再起波澜，各派弟子络绎于途。白帝城方向的灯火夜夜不熄。`);
  }

  // Round 1: introduce two characters' canon (chapters 1..14).
  if (chapterIndex <= 14) {
    for (const c of [characters[(chapterIndex - 1) * 2], characters[(chapterIndex - 1) * 2 + 1]]) {
      lines.push(...factSentences(c));
    }
  }
  // Round 2: cycle all characters through event/location facts (chapters 15..29).
  if (chapterIndex >= 15 && chapterIndex <= 29) {
    const slot = (chapterIndex - 15) * 2;
    for (const c of [characters[slot % characters.length], characters[(slot + 1) % characters.length]]) {
      lines.push(...cycleSentences(c));
    }
  }
  // Chapter 30: closing.
  if (chapterIndex === 30) {
    lines.push('第一场比试由天枢阁与沧海门的弟子对决，胜负未卜。');
  }

  lines.push('');
  lines.push('夜色渐深，白帝城的方向灯火明明灭灭，仿佛预示着论剑大会上的刀光剑影。江湖儿女各怀心事，在这乱世之中寻找自己的道。');
  lines.push('');
  lines.push('客栈的大堂里，说书人正讲到天下大势。北有蛮族窥伺，南有海盗作乱，中原武林看似太平，实则暗流汹涌。各大门派明争暗斗，只为在论剑大会上一鸣惊人。');
  lines.push('角落里的老者呷了一口浊酒，慢悠悠地说起三十年前的旧事。那年论剑大会上也曾出现过一位惊才绝艳的少年，一剑破尽十三路高手，最后却不知所踪。有人说他隐居山林，有人说他早已死了，更有人说他如今就在白帝城中。');
  lines.push('窗外忽然传来一声马嘶。驿道上的信使快马加鞭，带来了最新的战报。据说北方的几大门派已经联名下了帖子，要在大会之前先分个高下。茶馆里的客人议论纷纷，有人兴奋，有人担忧，更多的人只是看个热闹。');
  lines.push('雨又下起来了。雨水顺着屋檐滴落，在青石板上敲出细密的声响。这样的天气，最适合练剑，也最适合杀人。江湖上的恩怨，从来不会因为一场雨而停歇。');
  lines.push('');
  chapters.push(lines.join('\n'));
}

const novel = chapters.join('\n') + '\n';
const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'novel-medium.txt'), novel, 'utf8');
fs.writeFileSync(path.join(outDir, 'facts-medium.json'), JSON.stringify({ novel: 'novel-medium.txt', facts }, null, 2), 'utf8');

console.log(`chapters: 30`);
console.log(`chars (utf16 units): ${novel.length}`);
console.log(`annotated facts: ${facts.length}`);
