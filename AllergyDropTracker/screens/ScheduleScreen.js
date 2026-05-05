import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { loadData, saveData } from '../utils/storage';

const SETS = [-1, 1, 2, 3, 4];

export default function ScheduleScreen() {
  const [data, setData] = useState(null);

  useEffect(() => { loadData().then(setData); }, []);

  async function completeWeek() {
    if (!data) return;
    let updated = { ...data };

    if (updated.currentSet === 5) {
      Alert.alert('Already in Maintenance', 'You are in the maintenance phase.');
      return;
    }

    if (updated.currentWeek < 3) {
      updated.currentWeek = updated.currentWeek + 1;
    } else {
      const idx = SETS.indexOf(updated.currentSet);
      if (idx < SETS.length - 1) {
        updated.currentSet = SETS[idx + 1];
        updated.currentWeek = 1;
      } else {
        Alert.alert(
          'Start Maintenance?',
          'You have completed all build-up sets. Move to maintenance phase?',
          [
            { text: 'Not yet', style: 'cancel' },
            {
              text: 'Yes', onPress: async () => {
                updated.currentSet = 5;
                updated.currentWeek = 1;
                setData(updated);
                await saveData(updated);
              }
            }
          ]
        );
        return;
      }
    }

    setData(updated);
    await saveData(updated);
  }

  if (!data) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={s.muted}>Loading...</Text>
      </View>
    );
  }

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
              {data.currentSet === 5 ? data.maintenanceDrops : data.currentWeek}
            </Text>
            <Text style={s.bannerStatLabel}>Drops/day</Text>
          </View>
        </View>
        <TouchableOpacity style={s.advanceBtn} onPress={completeWeek}>
          <Text style={s.advanceBtnText}>Complete Week →</Text>
        </TouchableOpacity>
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
                const isPastWeek = past || (current && week < data.currentWeek);
                return (
                  <View key={week} style={[s.weekChip, isCurWeek && s.weekChipCurrent, isPastWeek && s.weekChipDone]}>
                    <Text style={[s.weekChipText, (isCurWeek || isPastWeek) && s.weekChipTextActive]}>
                      W{week}: {week} drop{week > 1 ? 's' : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
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
  bannerRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 16 },
  bannerStat: { alignItems: 'center', flex: 1 },
  bannerValue: { fontSize: 26, fontWeight: '800', color: '#fff' },
  bannerStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  bannerDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.3)' },
  advanceBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  advanceBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

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
});
