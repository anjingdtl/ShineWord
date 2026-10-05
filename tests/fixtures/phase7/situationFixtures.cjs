'use strict';
/**
 * P7-0 frozen acceptance fixtures (three distinct play styles).
 *
 * Synthetic fixtures — NOT real-novel material. Real-material acceptance
 * (P7-7) runs against the authorized 《放开那个女巫》 import. Every fixture
 * marks: canon baseline (explicit facts), future reference events
 * (worldTimeOrder > anchor), GM-only secrets, design_fill methods, legal
 * routes and expected persistent consequences per route.
 *
 * Anchors: each fixture opens at worldTimeOrder 20; future reference events
 * sit at order 30+ so campaign divergence is observable.
 */

/** Canonical provenance helper. */
function prov(kind, sourceFactIds, rationale) {
  return { kind, sourceFactIds, rationale };
}

function contentEntry(entryId, kind, definition, extra = {}) {
  return {
    entryId,
    kind,
    revision: 1,
    provenance: extra.provenance ?? prov('design_fill', [], 'p7 fixture'),
    fieldProvenance: extra.fieldProvenance ?? {},
    visibility: extra.visibility ?? 'gm',
    dependencyIds: extra.dependencyIds ?? [],
    definition,
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: 追查 / 救援 (rescue) — 师门遭袭
// ---------------------------------------------------------------------------
const rescue = {
  fixtureId: 'rescue',
  anchorWorldTimeOrder: 20,
  canon: {
    entities: [
      { entityId: 'ent-companion', name: '岳轻', type: 'character' },
      { entityId: 'ent-pursuer', name: '灰衣人', type: 'character' },
      { entityId: 'ent-helper', name: '柴掌柜', type: 'character' },
      { entityId: 'ent-sect', name: '青云观', type: 'location' },
      { entityId: 'ent-city', name: '临江城', type: 'location' },
    ],
    facts: [
      {
        factId: 'fact-sect-attacked', worldId: 'wf-rescue', entityId: 'ent-sect',
        kind: 'event', value: '青云观夜间遭灰衣人袭击', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 0, endCodePoint: 40, contentSha256: 'a'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        factId: 'fact-companion-injured', worldId: 'wf-rescue', entityId: 'ent-companion',
        kind: 'state', value: '岳轻在袭击中重伤倒地', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 41, endCodePoint: 90, contentSha256: 'a'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        factId: 'fact-trail-visible', worldId: 'wf-rescue', entityId: 'ent-pursuer',
        kind: 'event', value: '灰衣人夺走镇观信物后向北逃走，院外留下踪迹', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 91, endCodePoint: 150, contentSha256: 'a'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        factId: 'fact-helper-known', worldId: 'wf-rescue', entityId: 'ent-helper',
        kind: 'relation', value: '柴掌柜与青云观有旧，在临江城开医馆', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c2', startCodePoint: 0, endCodePoint: 60, contentSha256: 'b'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        // Future reference: only visible AFTER order 30 unless campaign diverges.
        factId: 'fact-companion-death-future', worldId: 'wf-rescue', entityId: 'ent-companion',
        kind: 'state', value: '岳轻伤重不治', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c9', startCodePoint: 0, endCodePoint: 30, contentSha256: 'c'.repeat(64) }],
        validFrom: '30', validTo: null, revealAt: '30',
      },
      // GM-only secret: the pursuer's employer (never in player paths).
      {
        factId: 'fact-pursuer-employer', worldId: 'wf-rescue', entityId: 'ent-pursuer',
        kind: 'relation', value: '灰衣人受北镇抚司密令行事', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c5', startCodePoint: 0, endCodePoint: 30, contentSha256: 'd'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: '45',
      },
    ],
    events: [
      {
        eventId: 'evt-sect-attack', worldId: 'wf-rescue', entityIds: ['ent-sect', 'ent-pursuer'],
        summary: '青云观遭袭', worldTimeOrder: 18, validFrom: '18', validTo: null, status: 'confirmed',
      },
      {
        // Future reference event: companion dies at order 30 UNLESS the branch
        // changes the precondition (actor_alive).
        eventId: 'evt-companion-death', worldId: 'wf-rescue', entityIds: ['ent-companion'],
        summary: '岳轻伤重不治', worldTimeOrder: 30, validFrom: '30', validTo: null, status: 'confirmed',
      },
    ],
  },
  entries: [
    contentEntry('skill-medicine', 'skill', {
      name: '医术', attribute: 'insight', allowUntrained: false, powerTier: 'ordinary', usage: 'utility',
    }, { visibility: 'public', provenance: prov('explicit', ['fact-helper-known'], 'fixture: 医馆存在') }),
    contentEntry('skill-tracking', 'skill', {
      name: '追踪', attribute: 'insight', allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge',
    }, { visibility: 'public', provenance: prov('explicit', ['fact-trail-visible'], 'fixture: 踪迹可见') }),
    contentEntry('skill-social', 'skill', {
      name: '交涉', attribute: 'social', allowUntrained: true, powerTier: 'ordinary', usage: 'social',
    }, { visibility: 'public' }),
    contentEntry('item-token', 'item', { name: '镇观信物', category: 'relic' }, {
      visibility: 'public', provenance: prov('explicit', ['fact-trail-visible'], 'fixture: 信物'),
    }),
    contentEntry('npc-companion', 'actor_template', {
      category: 'human', name: '岳轻', attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
      skills: {}, hp: 8, stamina: 6, defense: 2, attacks: [], abilities: [],
      behavior: { goal: '养伤并夺回信物', retreatThreshold: 0.2, morale: 'steady' },
    }, { visibility: 'public', provenance: prov('explicit', ['fact-companion-injured'], 'fixture: 同伴') }),
    contentEntry('npc-helper', 'actor_template', {
      category: 'human', name: '柴掌柜', attributes: { physique: 1, agility: 1, insight: 3, knowledge: 3, willpower: 2, social: 3 },
      skills: { 'skill-medicine': 'trained' }, hp: 6, stamina: 4, defense: 2, attacks: [], abilities: [],
      behavior: { goal: '照章程行医，护住旧交', retreatThreshold: 0.5, morale: 'steady' },
    }, { visibility: 'public', provenance: prov('explicit', ['fact-helper-known'], 'fixture: 援助者') }),
    contentEntry('scene-sect', 'scene', {
      name: '青云观废院', description: '遭袭后的道观废院', locationId: 'ent-sect',
      zones: [
        { zoneId: 'z-courtyard', name: '前院', cover: true, exits: ['z-hall'] },
        { zoneId: 'z-hall', name: '正殿', cover: false, exits: ['z-courtyard'] },
      ],
      actors: ['npc-companion'],
      visibleItems: [], hazards: [], clues: ['lore-north-trail'],
    }, { visibility: 'public', provenance: prov('explicit', ['fact-sect-attacked'], 'fixture: 场景') }),
    contentEntry('lore-north-trail', 'lore', { name: '北向踪迹', text: '院外泥地上的脚印向北延伸' }, {
      visibility: 'discoverable', provenance: prov('explicit', ['fact-trail-visible'], 'fixture: 线索'),
    }),
    // GM-only secret entry — must NEVER surface in player paths.
    contentEntry('lore-secret-employer', 'lore', { name: '北镇抚司密令', text: '灰衣人背后的委派人' }, {
      visibility: 'gm', provenance: prov('explicit', ['fact-pursuer-employer'], 'fixture: 秘密'),
    }),
    // The situation itself.
    contentEntry('situation-sect-aftermath', 'situation', {
      title: '观毁人伤',
      summary: '道观刚被袭击，同伴重伤，信物被夺，踪迹尚新。',
      gmBrief: '灰衣人受北镇抚司密令夺信物（GM-only）。玩家未发现前不得在任何玩家可见文本中出现。',
      locationId: 'scene-sect',
      participantEntryIds: ['npc-companion', 'npc-helper'],
      activation: { kind: 'all', of: [{ kind: 'actor_alive', actorId: 'actor-companion' }, { kind: 'world_time_at_least', order: 18 }] },
      knowledgeCondition: { kind: 'knowledge_known', entryId: 'lore-north-trail' },
      signs: [{ text: '院外有向北延伸的脚印', requiresKnowledgeEntryId: 'lore-north-trail' }],
      pressure: { deadlineClockSeconds: 7200, description: '踪迹会随时间消失；岳轻伤势在恶化' },
      methods: [
        {
          methodId: 'heal',
          title: '先救同伴',
          goal: '稳住岳轻的伤势',
          firstStep: { intent: '检查岳轻的伤势，用现有手段止血救治', actionKind: 'skill_check', skillId: 'skill-medicine', targetEntryId: 'npc-companion' },
          requires: { skillId: 'skill-medicine', minRank: 'trained' },
          tradeoffs: '花费时间；院外踪迹会逐渐模糊',
          preparation: '需要医术（受训）',
          successEffects: [
            { op: 'removeCondition', actorId: 'actor-companion', conditionId: 'bleeding' },
            { op: 'restoreResource', actorId: 'actor-companion', resourceId: 'hp', amount: 2, cap: 8 },
          ],
          onSuccess: [
            { kind: 'situation_counter', situationId: 'situation-sect-aftermath', counterId: 'companion_stabilized', delta: 1 },
          ],
        },
        {
          methodId: 'pursue',
          title: '追赶夺物者',
          goal: '循踪追击灰衣人，夺回镇观信物',
          firstStep: { intent: '查看院外向北的脚印，判断灰衣人离去方向', actionKind: 'skill_check', skillId: 'skill-tracking' },
          requires: { knowledgeEntryId: 'lore-north-trail' },
          tradeoffs: '同伴暂时无人照料，伤势可能恶化',
          preparation: '需要先观察到北向踪迹',
        },
        {
          methodId: 'seek-aid',
          title: '进城求援',
          goal: '请柴掌柜出手救治',
          firstStep: { intent: '前往临江城柴掌柜的医馆求助', actionKind: 'move', destinationId: 'ent-city' },
          requires: {},
          tradeoffs: '来回需要时间；救助不保证成功',
          preparation: '无',
        },
        {
          methodId: 'retreat',
          title: '带人撤离',
          goal: '先把岳轻转移到安全处',
          firstStep: { intent: '寻找能把岳轻安全抬离废院的门板与绳索', actionKind: 'interact' },
          requires: {},
          tradeoffs: '暂缓追回信物；踪迹窗口继续流失',
          preparation: '无',
        },
      ],
      transitions: {
        onSuccess: [
          { kind: 'set_situation_status', situationId: 'situation-sect-aftermath', status: 'resolved', resolution: '信物追回或同伴脱险' },
        ],
        onExpire: [
          { kind: 'set_situation_status', situationId: 'situation-sect-aftermath', status: 'resolved', resolution: '踪迹消失，救援窗口关闭' },
        ],
      },
      followUpSituationIds: [],
      referenceEvents: [
        {
          eventKey: 'evt-companion-death',
          worldTimeOrder: 30,
          situationId: 'situation-sect-aftermath',
          // Branch condition: the death reference only holds while the
          // companion is alive AND still bleeding — a successful rescue
          // removes 'bleeding', so the reference is suppressed with audit.
          condition: {
            kind: 'all',
            of: [
              { kind: 'actor_alive', actorId: 'actor-companion' },
              { kind: 'actor_condition', actorId: 'actor-companion', conditionId: 'bleeding' },
            ],
          },
          onDue: [
            { kind: 'set_situation_status', situationId: 'situation-sect-aftermath', status: 'resolved', resolution: '岳轻伤重不治' },
          ],
          actorFate: { actorId: 'actor-companion', lifeStatus: 'dead' },
        },
      ],
    }, {
      visibility: 'gm',
      provenance: prov('design_fill', ['fact-sect-attacked', 'fact-companion-injured', 'fact-trail-visible'], 'fixture: 局面组织'),
    }),
  ],
  playerActorId: 'actor-player',
  actorStates: {
    'actor-player': { actorId: 'actor-player', locationId: 'scene-sect', resources: { hp: 8, stamina: 6 }, conditions: [] },
    'actor-companion': { actorId: 'actor-companion', locationId: 'scene-sect', resources: { hp: 1, stamina: 2 }, conditions: ['bleeding'], lifeStatus: 'critical' },
  },
  openingKnowledge: ['lore-north-trail'],
  routes: {
    heal: {
      summary: '救治成功路线',
      expect: {
        companionAlive: true,
        referenceSuppressed: 'evt-companion-death',
        situationResolution: 'resolved',
        persistentPressure: '追踪窗口计数器减少',
      },
    },
    pursue: {
      summary: '追踪优先路线',
      expect: {
        companionStillCritical: true,
        discoveryOrLoss: true,
        noAutoHeal: true,
      },
    },
    seekAid: {
      summary: '求援路线（只执行联系首步）',
      expect: {
        firstStepOnly: true,
        noUnearnedReward: true,
        promiseOnlyIfAgreed: true,
      },
    },
    noAction: {
      summary: '不救基线（对照）',
      expect: {
        referenceEventEligibleAtOrder30: true,
        companionDeathAllowed: true,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture 2: 交涉 / 关系 (parley) — 军需官放行
// ---------------------------------------------------------------------------
const parley = {
  fixtureId: 'parley',
  anchorWorldTimeOrder: 20,
  canon: {
    entities: [
      { entityId: 'ent-quartermaster', name: '裴主事', type: 'character' },
      { entityId: 'ent-gate', name: '南仓门', type: 'location' },
    ],
    facts: [
      {
        factId: 'fact-quartermaster-duty', worldId: 'wf-parley', entityId: 'ent-quartermaster',
        kind: 'state', value: '裴主事按章程行事，无批文不放行', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 0, endCodePoint: 50, contentSha256: 'e'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        factId: 'fact-tally-lost', worldId: 'wf-parley', entityId: 'ent-quartermaster',
        kind: 'event', value: '押运途中名册落水损毁', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 51, endCodePoint: 100, contentSha256: 'e'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      // Secret: he owes a personal debt he hides (GM-only leverage).
      {
        factId: 'fact-qm-private-debt', worldId: 'wf-parley', entityId: 'ent-quartermaster',
        kind: 'state', value: '裴主事私欠漕帮人情，怕被上司知晓', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c3', startCodePoint: 0, endCodePoint: 40, contentSha256: 'f'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: '50',
      },
    ],
    events: [
      {
        eventId: 'evt-supply-impasse', worldId: 'wf-parley', entityIds: ['ent-quartermaster'],
        summary: '南仓门补给僵持', worldTimeOrder: 20, validFrom: '20', validTo: null, status: 'confirmed',
      },
    ],
  },
  entries: [
    contentEntry('skill-persuade', 'skill', {
      name: '说服', attribute: 'social', allowUntrained: true, powerTier: 'ordinary', usage: 'social',
    }, { visibility: 'public' }),
    contentEntry('item-seal', 'item', { name: '押运副印', category: 'tool' }, {
      visibility: 'public', provenance: prov('explicit', ['fact-tally-lost'], 'fixture: 补印工具'),
    }),
    contentEntry('npc-quartermaster', 'actor_template', {
      category: 'human', name: '裴主事', attributes: { physique: 1, agility: 1, insight: 3, knowledge: 3, willpower: 4, social: 3 },
      skills: {}, hp: 6, stamina: 5, defense: 3, attacks: [], abilities: [],
      behavior: { goal: '按章程办事，不出纰漏', retreatThreshold: 0.8, morale: 'steady' },
    }, { visibility: 'public', provenance: prov('explicit', ['fact-quartermaster-duty'], 'fixture: 军需官') }),
    contentEntry('quest-restamp', 'quest', {
      name: '补办名册',
      description: '帮裴主事补录损毁的名册，换取放行。',
      trigger: { eventType: 'knowledge_discovered', summaryPattern: '仓门章程' },
      objectives: [{ objectiveId: 'obj-evidence', description: '核对章程线索', counter: 'knowledge_discovered', target: 1 }],
      rewards: { items: ['item-supply-writ'] },
      failurePath: '名册补录失败，仍需另寻放行途径。',
    }, { visibility: 'public' }),
    contentEntry('item-supply-writ', 'item', { name: '放行条', category: 'document' }, { visibility: 'public' }),
    contentEntry('lore-qm-rules', 'lore', { name: '仓门章程', text: '有印即放，无文不放' }, {
      visibility: 'discoverable', provenance: prov('explicit', ['fact-quartermaster-duty'], 'fixture: 章程线索'),
    }),
    contentEntry('scene-gate', 'scene', {
      name: '南仓门前', description: '补给车被拦下的仓门', locationId: 'ent-gate',
      zones: [
        { zoneId: 'z-gate', name: '仓门', cover: false, exits: ['z-yard'] },
        { zoneId: 'z-yard', name: '货场', cover: true, exits: ['z-gate'] },
      ],
      actors: ['npc-quartermaster'], visibleItems: [], hazards: [], clues: ['lore-qm-rules'],
    }, { visibility: 'public', provenance: prov('explicit', ['fact-quartermaster-duty'], 'fixture: 场景') }),
    contentEntry('lore-secret-debt', 'lore', { name: '漕帮人情', text: '裴主事私欠漕帮人情' }, {
      visibility: 'gm', provenance: prov('explicit', ['fact-qm-private-debt'], 'fixture: 秘密'),
    }),
    contentEntry('situation-supply-impasse', 'situation', {
      title: '仓门僵持',
      summary: '补给被扣在南仓门，裴主事按章程不放行。',
      gmBrief: '裴主事私欠漕帮人情（GM-only，未发现前不得出现在玩家路径）。',
      locationId: 'ent-gate',
      participantEntryIds: ['npc-quartermaster'],
      activation: { kind: 'world_time_at_least', order: 20 },
      signs: [{ text: '裴主事反复核对残缺名册' }],
      pressure: { description: '队伍补给只够三日' },
      methods: [
        {
          methodId: 'persuade',
          title: '当面陈情',
          goal: '说服裴主事通融放行',
          firstStep: { intent: '向裴主事说明处境，请求通融放行', actionKind: 'skill_check', skillId: 'skill-persuade', targetEntryId: 'npc-quartermaster' },
          requires: {},
          tradeoffs: '失败会让他更警惕；关系随结果变化',
          preparation: '无',
        },
        {
          methodId: 'restamp',
          title: '补办名册',
          goal: '凑齐印信文书，走正规途径',
          firstStep: { intent: '取出押运副印，提出补办名册', actionKind: 'interact' },
          requires: { itemId: 'item-seal' },
          tradeoffs: '花时间走流程，但关系损耗最小',
          preparation: '需要持有押运副印',
        },
        {
          methodId: 'errand',
          title: '先办他的难事',
          goal: '接下名册补录的委托，换取放行',
          firstStep: { intent: '询问裴主事名册损毁的经过，表示可以帮忙补录', actionKind: 'talk', targetEntryId: 'npc-quartermaster' },
          requires: {},
          tradeoffs: '多花一整段时间；可能形成承诺',
          preparation: '无',
        },
      ],
      transitions: {
        onSuccess: [
          { kind: 'set_situation_status', situationId: 'situation-supply-impasse', status: 'resolved', resolution: '获得放行' },
        ],
      },
      followUpSituationIds: [],
      referenceEventKeys: [],
    }, {
      visibility: 'gm',
      provenance: prov('design_fill', ['fact-quartermaster-duty', 'fact-tally-lost'], 'fixture: 局面组织'),
    }),
  ],
  playerActorId: 'actor-player',
  actorStates: {
    'actor-player': { actorId: 'actor-player', locationId: 'ent-gate', resources: { hp: 8, stamina: 6 }, conditions: [] },
  },
  openingKnowledge: [],
  routes: {
    persuade: {
      summary: '交涉路线',
      expect: { relationshipChanges: true, socialSkillUsed: 'skill-persuade', secretNeverLeaked: true },
    },
    restamp: {
      summary: '以物易物路线',
      expect: { itemRequired: 'item-seal', questPathLikely: true, relationLossMinimal: true },
    },
    errand: {
      summary: '委托路线',
      expect: { questActivated: 'quest-restamp', promiseMayForm: true, timeCostReal: true },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture 3: 探索 / 成长 (ruin) — 废墟密门
// ---------------------------------------------------------------------------
const ruin = {
  fixtureId: 'ruin',
  anchorWorldTimeOrder: 20,
  canon: {
    entities: [
      { entityId: 'ent-ruin', name: '荒塔遗迹', type: 'location' },
      { entityId: 'ent-order', name: '守塔人残党', type: 'character' },
    ],
    facts: [
      {
        factId: 'fact-ruin-door', worldId: 'wf-ruin', entityId: 'ent-ruin',
        kind: 'state', value: '塔底有一扇刻纹石门，无锁孔', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 0, endCodePoint: 40, contentSha256: '1'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
      {
        factId: 'fact-ruin-wall', worldId: 'wf-ruin', entityId: 'ent-ruin',
        kind: 'state', value: '塔身西侧有可攀爬的裂隙', status: 'confirmed', scope: 'world',
        sources: [{ chapterId: 'c1', startCodePoint: 41, endCodePoint: 80, contentSha256: '2'.repeat(64) }],
        validFrom: '0', validTo: null, revealAt: null,
      },
    ],
    events: [
      {
        eventId: 'evt-ruin-found', worldId: 'wf-ruin', entityIds: ['ent-ruin'],
        summary: '发现荒塔遗迹', worldTimeOrder: 20, validFrom: '20', validTo: null, status: 'confirmed',
      },
    ],
  },
  entries: [
    contentEntry('skill-climb', 'skill', {
      name: '攀爬', attribute: 'agility', allowUntrained: true, powerTier: 'ordinary', usage: 'utility',
    }, { visibility: 'public', provenance: prov('explicit', ['fact-ruin-wall'], 'fixture: 裂隙可攀') }),
    contentEntry('skill-lore', 'skill', {
      name: '古迹学识', attribute: 'knowledge', allowUntrained: false, powerTier: 'ordinary', usage: 'knowledge',
    }, { visibility: 'public', provenance: prov('inferred', ['fact-ruin-door'], 'fixture: 刻纹可辨') }),
    contentEntry('item-crowbar', 'item', { name: '铁撬棍', category: 'tool' }, { visibility: 'public' }),
    contentEntry('scene-ruin', 'scene', {
      name: '荒塔遗迹', description: '荒废古塔的底部', locationId: 'ent-ruin',
      zones: [
        { zoneId: 'z-door', name: '塔底石门前', cover: false, exits: ['z-ledge'] },
        { zoneId: 'z-ledge', name: '西侧裂隙', cover: true, exits: ['z-door'] },
      ],
      actors: [], visibleItems: [], hazards: [], clues: ['lore-door-carving'],
    }, { visibility: 'public', provenance: prov('explicit', ['fact-ruin-door'], 'fixture: 场景') }),
    contentEntry('lore-door-carving', 'lore', { name: '门上刻纹', text: '石门刻纹似古国星图' }, {
      visibility: 'discoverable', provenance: prov('explicit', ['fact-ruin-door'], 'fixture: 线索'),
    }),
    contentEntry('situation-sealed-door', 'situation', {
      title: '密门之谜',
      summary: '荒塔底部的刻纹石门挡住去路。',
      gmBrief: '门后是守塔人残党的旧库（GM-only，未开启前不得透露）。',
      locationId: 'scene-ruin',
      participantEntryIds: [],
      activation: { kind: 'world_time_at_least', order: 20 },
      signs: [{ text: '石门刻纹在火光下似有规律', requiresKnowledgeEntryId: 'lore-door-carving' }],
      pressure: { description: '无硬性期限，但夜里有野兽出没' },
      methods: [
        {
          methodId: 'study',
          title: '辨读刻纹',
          goal: '解读星图刻纹，找到开门机关',
          firstStep: { intent: '仔细查看石门刻纹，尝试辨读其中规律', actionKind: 'skill_check', skillId: 'skill-lore' },
          requires: { knowledgeEntryId: 'lore-door-carving', skillId: 'skill-lore', minRank: 'trained' },
          tradeoffs: '需要学识功底；耗神力',
          preparation: '需要先观察到刻纹并受训于古迹学识',
        },
        {
          methodId: 'climb',
          title: '攀爬裂隙',
          goal: '从西侧裂隙翻上二层，绕过石门',
          firstStep: { intent: '检查西侧裂隙的落脚点，准备攀爬', actionKind: 'skill_check', skillId: 'skill-climb' },
          requires: { skillId: 'skill-climb' },
          tradeoffs: '有坠落风险；不解决门本身的谜题',
          preparation: '无',
        },
        {
          methodId: 'tool',
          title: '找工具撬门',
          goal: '取铁撬棍强行撬开石门',
          firstStep: { intent: '想办法寻找能撬动石门的工具', actionKind: 'talk' },
          requires: { itemId: 'item-crowbar' },
          tradeoffs: '动静大，可能惊动四周；门可能受损',
          preparation: '需要先获得铁撬棍（当前未持有）',
        },
      ],
      transitions: {
        onSuccess: [
          { kind: 'set_situation_status', situationId: 'situation-sealed-door', status: 'resolved', resolution: '进入塔底旧库' },
        ],
      },
      followUpSituationIds: [],
      referenceEventKeys: [],
    }, {
      visibility: 'gm',
      provenance: prov('design_fill', ['fact-ruin-door', 'fact-ruin-wall'], 'fixture: 局面组织'),
    }),
  ],
  playerActorId: 'actor-player',
  actorStates: {
    'actor-player': { actorId: 'actor-player', locationId: 'scene-ruin', resources: { hp: 8, stamina: 6 }, conditions: [] },
  },
  openingKnowledge: [],
  routes: {
    study: {
      summary: '学识路线（需要前置发现）',
      expect: { knowledgeGated: 'lore-door-carving', skillGated: 'skill-lore', practicePossible: true },
    },
    climb: {
      summary: '攀爬路线',
      expect: { riskReal: true, failureChangesState: true, doorPuzzleRemains: true },
    },
    tool: {
      summary: '工具路线（needs_preparation）',
      expect: { needsPreparation: 'item-crowbar', notDirectlyExecutable: true, readinessFlow: true },
    },
  },
};

module.exports = {
  FIXTURES: { rescue, parley, ruin },
  prov,
  contentEntry,
};
