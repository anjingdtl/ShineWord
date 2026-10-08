/** Resolve a scoped template to its actual snapshot owner. Explicit actor IDs
 * win; ambiguous templates remain unresolved instead of selecting a person. */
export function createActorReferenceResolver(input: {
  actors: Readonly<Record<string, unknown>>;
  cards?: ReadonlyArray<{ actorId: string; templateId?: string }>;
}): (id: string) => string {
  const aliases = new Map<string, string | null>();
  for (const card of input.cards ?? []) {
    if (!card.templateId || !input.actors[card.actorId]) continue;
    const previous = aliases.get(card.templateId);
    aliases.set(card.templateId, previous === undefined || previous === card.actorId ? card.actorId : null);
  }
  return id => {
    if (input.actors[id]) return id;
    // A catalog template may itself start with npc-. Match its complete ID
    // before interpreting the conventional runtime prefix.
    if (aliases.has(id)) return aliases.get(id) ?? id;
    const template = id.startsWith('npc-') ? id.slice(4) : id;
    if (aliases.has(template)) return aliases.get(template) ?? id;
    // Historical snapshots may retain a materialized NPC without a card.
    if (input.actors[`npc-${id}`]) return `npc-${id}`;
    const conventional = `actor-${template}`;
    return input.actors[conventional] ? conventional : id;
  };
}
