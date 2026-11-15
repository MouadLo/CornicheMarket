import { useEffect, useState } from "react";
import { Image, ScrollView, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BigButton } from "@/src/components/BigButton";
import { invoicePhotoUrl } from "@/src/lib/stock/invoices";
import { Text } from "@/src/theme/Text";

export function InvoicePhotos({ paths }: { paths: string[] }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const path = paths[page];
  const viewport = Math.max(180, width - 40);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setUrl(null);
    setError(false);
    invoicePhotoUrl(path).then(
      (value) => {
        if (active) setUrl(value);
      },
      () => {
        if (active) setError(true);
      }
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);

  if (!path) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text>{t("invoices.photoPage", { page: page + 1, count: paths.length })}</Text>
      {error ? (
        <BigButton label={t("invoices.retry")} onPress={() => setAttempt((value) => value + 1)} />
      ) : url ? (
        <ScrollView horizontal style={{ maxHeight: viewport * 1.3 }}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: viewport * 1.3 }}>
            <Image
              source={{ uri: url }}
              onError={() => setError(true)}
              resizeMode="contain"
              accessibilityLabel={t("invoices.photos")}
              style={{ width: viewport * (zoom ? 2 : 1), height: viewport * (zoom ? 2.6 : 1.3) }}
            />
          </ScrollView>
        </ScrollView>
      ) : (
        <Text>{t("invoices.loadingPhoto")}</Text>
      )}
      <BigButton
        variant="secondary"
        label={t(zoom ? "invoices.zoomOut" : "invoices.zoomIn")}
        onPress={() => setZoom(!zoom)}
      />
      {page > 0 && (
        <BigButton
          variant="secondary"
          label={t("invoices.previousPage")}
          onPress={() => {
            setUrl(null);
            setPage(page - 1);
          }}
        />
      )}
      {page + 1 < paths.length && (
        <BigButton
          variant="secondary"
          label={t("invoices.nextPage")}
          onPress={() => {
            setUrl(null);
            setPage(page + 1);
          }}
        />
      )}
    </View>
  );
}
