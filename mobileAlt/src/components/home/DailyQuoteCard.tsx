import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

interface Quote {
  text: string;
  attribution: string;
}

// 37 quotes — training & mentality. Curated by Anup, fighters + Mentzer + Kobe.
// Add to this list freely; daily selection is mod by length so it scales.
const QUOTES: Quote[] = [
  // Khabib Nurmagomedov
  { text: 'Train hard, fight easy.', attribution: 'Khabib Nurmagomedov' },
  { text: 'I train, eat, sleep, and repeat.', attribution: 'Khabib Nurmagomedov' },
  { text: "Eagles don't stay in the cage.", attribution: 'Khabib Nurmagomedov' },
  { text: 'Climb the mountain so you can see the world, not so the world can see you.', attribution: 'Khabib Nurmagomedov' },
  { text: 'When you have a hard life, a tough life, success becomes very easy.', attribution: 'Khabib Nurmagomedov' },
  { text: 'You have to work for your dreams, nobody will hand them to you.', attribution: 'Khabib Nurmagomedov' },

  // Mike Mentzer
  { text: 'In order to lead the orchestra, you must first turn your back to the crowd.', attribution: 'Mike Mentzer' },
  { text: "Don't just be a bodybuilder — be the greatest bodybuilder that you can possibly be.", attribution: 'Mike Mentzer' },
  { text: 'The only one you can accurately compare yourself to is you.', attribution: 'Mike Mentzer' },
  { text: "One cannot actualize his goals until he visualizes them clearly in the mind's eye.", attribution: 'Mike Mentzer' },
  { text: 'Man can and ought to be a hero.', attribution: 'Mike Mentzer' },

  // Jon Jones
  { text: 'There is no substitute for hard work.', attribution: 'Jon Jones' },
  { text: 'Success is not going to just come to you. You must go out and get it.', attribution: 'Jon Jones' },
  { text: 'I will get out there and train harder than anyone, five times a day sometimes.', attribution: 'Jon Jones' },
  { text: "If you do something bad, it doesn't mean you're a bad person.", attribution: 'Jon Jones' },

  // Islam Makhachev
  { text: 'Just train hard and you gonna be champion.', attribution: 'Islam Makhachev' },
  { text: "It doesn't matter — I'm always training hard, doesn't matter how many rounds.", attribution: 'Islam Makhachev' },
  { text: "If you're a real champion, you have to fight.", attribution: 'Islam Makhachev' },
  { text: "Everybody wants to take this belt — I'm not going to give the chance to anyone.", attribution: 'Islam Makhachev' },

  // Ilia Topuria
  { text: 'Discipline makes me happy.', attribution: 'Ilia Topuria' },
  { text: "There's no negotiation — if I must do something, I'm going to do it, no matter what.", attribution: 'Ilia Topuria' },
  { text: "I'm competing against myself in every moment.", attribution: 'Ilia Topuria' },
  { text: 'I stay focused, present, and in control. Calm, disciplined, and ready for whatever.', attribution: 'Ilia Topuria' },
  { text: 'I still feel like my best performances are ahead of me.', attribution: 'Ilia Topuria' },

  // Haddy Abdel / Diamond Gym
  { text: "It's not too heavy. You just not strong enough.", attribution: 'Haddy Abdel' },
  { text: 'Make pain respect you.', attribution: 'Haddy Abdel' },
  { text: 'Your body can handle more.', attribution: 'Haddy Abdel' },
  { text: 'We are all strangers until we share the pain.', attribution: 'Haddy Abdel' },
  { text: 'My ambition was never greed. It was responsibility.', attribution: 'Haddy Abdel' },
  { text: 'I love to fail because it gives me a reason to go back.', attribution: 'Haddy Abdel' },

  // Kobe Bryant
  { text: 'You have to work hard in the dark to shine in the light.', attribution: 'Kobe Bryant' },
  { text: 'Everything negative — pressure, challenges — is all an opportunity for me to rise.', attribution: 'Kobe Bryant' },
  { text: 'If you really want to be great at something, you have to obsess over it.', attribution: 'Kobe Bryant' },
  { text: "I can't relate to lazy people. We don't speak the same language.", attribution: 'Kobe Bryant' },
  { text: 'Hard work outweighs talent — every time.', attribution: 'Kobe Bryant' },
  { text: "It doesn't matter how hard you work — I'm willing to work harder than you.", attribution: 'Kobe Bryant' },
  { text: "It's not the destination, it's the journey.", attribution: 'Kobe Bryant' },
];

// Stable per-day picker. Same quote all day, rolls at local midnight.
function quoteForToday(date: Date = new Date()): Quote {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % QUOTES.length;
  return QUOTES[idx];
}

export function DailyQuoteCard() {
  const quote = useMemo(() => quoteForToday(), []);
  return (
    <View style={styles.card}>
      <View style={styles.accentBar} />
      <View style={styles.content}>
        <Ionicons name="flame" size={14} color={colors.primary} style={styles.icon} />
        <Text style={styles.quoteText}>"{quote.text}"</Text>
        <Text style={styles.attribution}>— {quote.attribution}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    gap: 6,
  },
  icon: {
    marginBottom: 2,
  },
  quoteText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 21,
    fontStyle: 'italic',
    fontWeight: fontWeight.medium,
  },
  attribution: {
    fontSize: 11,
    color: colors.mutedForeground,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
