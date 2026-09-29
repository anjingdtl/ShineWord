import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export type ActionChoice =
  | { id: string; kind: 'act'; label: string; intent: string }
  | { id: string; kind: 'inspect'; label: string; target?: 'knowledge' | 'quests' | 'combatants' | 'scene_encounters' }
  | { id: string; kind: 'start_encounter'; label: string; sceneEntryId: string }
  | { id: string; kind: 'attack'; label: string; targetActorId: string }
  | { id: string; kind: 'rescue'; label: string; targetActorId: string }
  | { id: string; kind: 'retreat'; label: string };

export function ActionChoices(props: {
  choices: ActionChoice[];
  disabled?: boolean;
  onChoose: (choice: ActionChoice) => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  const choices = props.choices.slice(0, 3);
  if (choices.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: theme.space.lg, paddingVertical: theme.space.xs, gap: theme.space.xs }}>
      <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>你可以</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
        {choices.map(choice => (
          <Button
            key={choice.id}
            label={choice.label}
            variant="chip"
            onPress={() => props.onChoose(choice)}
            disabled={props.disabled}
            accessibilityLabel={`选择行动：${choice.label}`}
            testID={`story-choice-${choice.id}`}
          />
        ))}
      </View>
    </View>
  );
}
