/**
 * The pre-revamp shared StyleSheet, moved out of App.tsx verbatim.
 *
 * P2 only relocates screens and wires the navigator; their interiors are
 * deliberately unchanged (plan §6: 拆屏 is its own phase). These styles are
 * therefore still literal-colour based and are deleted screen by screen as
 * P3/P4 move each surface onto `useTheme()` tokens.
 */
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#08141f', padding: 18 },
  center: {
    flex: 1,
    backgroundColor: '#08141f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '700' },
  titleSmall: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#8ea1b2', fontSize: 13, marginTop: 4, marginBottom: 18 },
  sectionTitle: { color: '#d9a441', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  muted: { color: '#8ea1b2', fontSize: 12, lineHeight: 19 },
  danger: { color: '#ffce7a', fontSize: 12, lineHeight: 19, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#263a4d',
    backgroundColor: '#0e2030',
    color: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  primary: {
    backgroundColor: '#d9a441',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: '#101820', fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: '#3b5568',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginTop: 4,
  },
  secondaryActive: { borderColor: '#d9a441' },
  secondaryText: { color: '#d9a441', fontWeight: '600', fontSize: 13 },
  error: { color: '#ff9b9b', marginTop: 10, lineHeight: 20 },
  link: { color: '#d9a441', fontWeight: '600' },
  story: { flex: 1 },
  card: {
    backgroundColor: '#0e2030',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  encounterCard: {
    backgroundColor: '#13203a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: '#d9a441', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  dice: { color: '#91b6d7', fontSize: 12, marginBottom: 8 },
  bodyText: { color: '#e6edf3', fontSize: 15, lineHeight: 23 },
  resumed: { color: '#79c99e', fontSize: 11, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 4, flexWrap: 'wrap' },
  attrLabel: { color: '#e6edf3', width: 48, fontSize: 14 },
  attrValue: { color: '#d9a441', width: 36, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  step: {
    borderWidth: 1,
    borderColor: '#3b5568',
    borderRadius: 8,
    width: 34,
    alignItems: 'center',
    paddingVertical: 4,
    marginHorizontal: 6,
  },
  entryBox: { borderTopWidth: 1, borderTopColor: '#1d3247', paddingVertical: 8 },
  entryName: { color: '#f1f5f9', fontWeight: '700', fontSize: 14 },
  tag: { color: '#79c99e', fontSize: 11, marginRight: 8, marginTop: 4 },
  composer: { paddingTop: 10 },
  composerInput: { minHeight: 62, maxHeight: 120 },
});
