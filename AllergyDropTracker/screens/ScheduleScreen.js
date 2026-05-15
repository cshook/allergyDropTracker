import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadData, saveData, BUILDUP_SETS } from '../utils/storage';

const SETS = [-1, 1, 2, 3, 4];

export default function ScheduleScreen() {
  const [data, setData] = useState(null);

  useFocusEffect(useCallback(() => { loadData().then(setData); }, []));

  if (!data) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={s.muted}>Loading...</Text>
      </View>
    );
  }

  const isMaintenance = data.currentSet === 5;
  const currentSetIdx = BUILDUP_SETS.indexOf(data.currentSet);
  const progressSlots = isMaintenance ? 8 : 7;
  const progressFilled = isMaintenance
    ? Math.min(data.currentWeek - 1, 8)
    : Math.min(Object.values(data.log || {}).filter(e =>
        e.set === data.currentSet && e.week === data.currentWeek &&
        (e.status === 'taken' || e.status === 'manual')
      ).length, 7);
  const progressLeftLabel = isMaintenance ? null : `Set ${data.currentSet}`;
  const progressRightLabel = isMaintenance
    ? 'Reorder'
    : (data.currentSet === 4 ? 'Maint.' : `Set ${BUILDUP_SETS[currentSetIdx + 1]}`);

  const set4Week3Done = data.currentSet === 4 &&
    Object.values(data.log || {}).filter(e =>
      e.set === 4 && e.week === 3 && (e.status === 'taken' || e.status === 'manual')
    ).length >= 7;

  const isCurrentSet = (set) => data.currentSet === set;
  const isPastSet = (set) => {
    if (data.currentSet === 5) return true;
    const currentIdx = SETS.indexOf(data.currentSet);
    const setIdx = SETS.indexOf(set);
    return setIdx < currentIdx;
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Current Position Banner */}
      <View style={s.banner}>
        <Text style={s.bannerLabel}>CURRENT POSITION</Text>
        <View style={s.bannerRow}>
          <View style={s.bannerStat}>
            <Text style={s.bannerValue}>{data.currentSet === 5 ? 'MD' : data.currentSet}</Text>
            <Text style={s.bannerStatLabel}>Set</Text>
          </View>
          <View style={s.bannerDivider} />
          <View style={s.bannerStat}>
            <Text style={s.bannerValue}>
              {data.currentSet === 5 ? 'M' : `W${data.currentWeek}`}
            </Text>
            <Text style={s.bannerStatLabel}>
              {data.currentSet === 5 ? 'Maintenance' : 'Week'}
            </Text>
          </View>
          <View style={s.bannerDivider} />
          <View style={s.bannerStat}>
            <Text style={s.bannerValue}>
              {data.currentSet === 5 ? data.maintenanceDrops : Math.min(data.currentWeek, 3)}
            </Text>
            <Text style={s.bannerStatLabel}>Drops/day</Text>
          </View>
        </View>
        <View style={s.bannerProgressRow}>
          {progressLeftLabel
            ? <Text style={s.bannerProgressLabel}>{progressLeftLabel}</Text>
            : <View style={s.bannerProgressLabelSpacer} />}
          <View style={s.bannerProgressTrack}>
            {Array.from({ length: progressSlots }).map((_, i) => (
              <View key={i} style={[s.bannerProgressSlot, i < progressFilled && s.bannerProgressSlotFilled]} />
            ))}
          </View>
          <Text style={s.bannerProgressLabel}>{progressRightLabel}</Text>
        </View>
        <Text style={s.bannerProgressCaption}>
          {isMaintenance ? 'each slot = 1 week' : 'each slot = 1 dose'}
        </Text>
      </View>

      {/* Build-up Sets */}
      <Text style={s.sectionTitle}>Build-Up Phase</Text>
      {SETS.map(set => {
        const current = isCurrentSet(set);
        const past = isPastSet(set);
        return (
          <View key={set} style={[s.card, current && s.cardActive, past && s.cardPast]}>
            <View style={s.cardHeader}>
              <Text style={[s.setName, current && s.setNameActive]}>Set {set}</Text>
              {past && <Text style={s.badge}>✓ Done</Text>}
              {current && <Text style={[s.badge, s.badgeCurrent]}>● Current</Text>}
            </View>
            <View style={s.weeksRow}>
              {[1, 2, 3].map(week => {
                const isCurWeek = current && data.currentWeek === week;
                const isPastWeek = past || (current && week < data.currentWeek) || (set === 4 && current && set4Week3Done);
                return (
                  <View key={week} style={[s.weekChip, isCurWeek && !set4Week3Done && s.weekChipCurrent, isPastWeek && s.weekChipDone]}>
                    <Text style={[s.weekChipText, (isCurWeek || isPastWeek) && s.weekChipTextActive]}>
                      W{week}: {week} drop{week > 1 ? 's' : ''}
                    </Text>
                  </View>
                );
              })}
              {set === 4 && current && set4Week3Done && data.currentWeek > 3 && (
                <View style={[s.weekChip, s.weekChipCurrent]}>
                  <Text style={[s.weekChipText, s.weekChipTextActive]}>
                    Cont. W{data.currentWeek - 3}: 3 drops
                  </Text>
                </View>
              )}
            </View>
            {set === 4 && current && set4Week3Done && (
              <TouchableOpacity style={s.mdSwitchBtn} onPress={() => {
                Alert.alert(
                  'Switch to Maintenance?',
                  'Your maintenance drops have arrived. Switch now?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Switch', onPress: async () => {
                        const updated = { ...data, currentSet: 5, currentWeek: 1 };
                        setData(updated);
                        await saveData(updated);
                      }
                    },
                  ]
                );
              }}>
                <Text style={s.mdSwitchBtnText}>Switch to Maintenance →</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {/* Maintenance */}
      <Text style={s.sectionTitle}>Maintenance Phase</Text>
      <View style={[s.card, data.currentSet === 5 && s.cardActive]}>
        <View style={s.cardHeader}>
          <Text style={[s.setName, data.currentSet === 5 && s.setNameActive]}>
            Maintenance
          </Text>
          {data.currentSet === 5 && (
            <Text style={[s.badge, s.badgeCurrent]}>● Current</Text>
          )}
        </View>
        <Text style={s.maintenanceDesc}>
          {data.maintenanceDrops} drops/day · Indefinite · Configured in Settings
        </Text>
      </View>

    </ScrollView>
  );
}

const BLUE = '#4f8ef7';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4ff' },
  content: { padding: 16, gap: 12 },
  center: { justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#aaa', fontSize: 15 },

  banner: {
    backgroundColor: BLUE,
    borderRadius: 16,
    padding: 20,
  },
  bannerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.7)', marginBottom: 12 },
  bannerRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 14 },
  bannerStat: { alignItems: 'center', flex: 1 },
  bannerValue: { fontSize: 26, fontWeight: '800', color: '#fff' },
  bannerStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  bannerDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.3)' },

  bannerProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerProgressTrack: { flex: 1, flexDirection: 'row', gap: 3 },
  bannerProgressSlot: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  bannerProgressSlotFilled: { backgroundColor: '#fff' },
  bannerProgressLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)', minWidth: 40, textAlign: 'center' },
  bannerProgressLabelSpacer: { minWidth: 40 },
  bannerProgressCaption: { fontSize: 10, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 5 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#aaa', letterSpacing: 0.8, marginTop: 4 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: BLUE },
  cardPast: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  setName: { fontSize: 16, fontWeight: '700', color: '#333' },
  setNameActive: { color: BLUE },
  badge: { fontSize: 12, color: '#aaa', fontWeight: '600' },
  badgeCurrent: { color: BLUE },

  weeksRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  weekChip: { backgroundColor: '#f0f4ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  weekChipCurrent: { backgroundColor: BLUE },
  weekChipDone: { backgroundColor: '#e8f5e9' },
  weekChipText: { fontSize: 13, color: '#777', fontWeight: '500' },
  weekChipTextActive: { color: '#fff', fontWeight: '700' },

  maintenanceDesc: { fontSize: 14, color: '#777' },

  mdSwitchBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUE,
    alignSelf: 'flex-start',
  },
  mdSwitchBtnText: { color: BLUE, fontWeight: '700', fontSize: 14 },
});
