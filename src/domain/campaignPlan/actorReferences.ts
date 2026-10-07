/** Actor aliases are accepted only when backed by the trusted scoped template. */
export function actorReferenceInScope(id: unknown, scope: {
  openingActorIds: ReadonlySet<string>;
  openingTemplateIds: ReadonlySet<string>;
}): boolean {
  return typeof id === 'string' && (scope.openingActorIds.has(id) || scope.openingTemplateIds.has(id)
    || (id.startsWith('npc-') && scope.openingTemplateIds.has(id.slice(4))));
}
