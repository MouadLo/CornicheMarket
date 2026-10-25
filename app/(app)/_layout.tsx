import { Link, Tabs, usePathname } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Slot } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/src/lib/auth/AuthProvider';

type NavItem = {
  name: string;
  labelKey: 'sell' | 'products' | 'stockIn' | 'reports' | 'settings';
  ownerOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { name: 'sell', labelKey: 'sell' },
  { name: 'products', labelKey: 'products' },
  { name: 'stock-in', labelKey: 'stockIn' },
  { name: 'reports', labelKey: 'reports', ownerOnly: true },
  { name: 'settings', labelKey: 'settings' },
];

export default function AppLayout() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isOwner = profile?.role === 'owner';

  if (Platform.OS === 'web') {
    return <WebSidebarLayout isOwner={isOwner} />;
  }

  return (
    <Tabs>
      {NAV_ITEMS.map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            title: t(`nav.${item.labelKey}`),
            href: item.ownerOnly && !isOwner ? null : undefined,
          }}
        />
      ))}
    </Tabs>
  );
}

function WebSidebarLayout({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const visibleItems = NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner);

  return (
    <View style={styles.webRoot}>
      <View style={styles.sidebar}>
        <Text style={styles.sidebarTitle}>Corniche Market</Text>
        {visibleItems.map((item) => {
          const active = pathname === `/${item.name}` || pathname.endsWith(`/${item.name}`);
          return (
            // No `asChild` here: it merges props through Radix Slot, which
            // spreads a style array into an object with numeric keys and
            // breaks the DOM style on web.
            <Link
              key={item.name}
              href={`/(app)/${item.name}` as never}
              style={[styles.sidebarLink, active && styles.sidebarLinkActive]}
            >
              {t(`nav.${item.labelKey}`)}
            </Link>
          );
        })}
      </View>
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webRoot: { flex: 1, flexDirection: 'row', minHeight: '100%' },
  sidebar: {
    width: 220,
    borderRightWidth: 1,
    borderRightColor: '#e2e2e2',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 4,
  },
  sidebarTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  sidebarLink: {
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    color: '#333',
  },
  sidebarLinkActive: { backgroundColor: '#e8f3ec', color: '#1d7a46', fontWeight: '600' },
  content: { flex: 1 },
});
