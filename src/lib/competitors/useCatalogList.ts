import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogRow, CatalogView, ListFilters } from "@/src/lib/competitors/catalog";
import { fetchCatalogPage } from "@/src/lib/competitors/shops";
import { errorKey } from "@/src/lib/errors/userMessage";

// One paged list of a view (À confirmer, Vous ne l'avez pas, À sourcer): the
// database filters, sorts and counts; this loads 30 rows at a time.
export function useCatalogList(view: CatalogView, filters: ListFilters) {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const rowsRef = useRef<CatalogRow[]>([]);
  const key = JSON.stringify(filters);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchCatalogPage(view, filters, 0);
      if (mine !== generation.current) return;
      rowsRef.current = page;
      setRows(page);
      setTotal(page[0]?.total_count ?? 0);
    } catch (failure) {
      if (mine === generation.current) setError(errorKey(failure));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || rowsRef.current.length >= total) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchCatalogPage(view, filters, rowsRef.current.length);
      if (mine !== generation.current) return;
      rowsRef.current = [...rowsRef.current, ...page];
      setRows(rowsRef.current);
      setTotal(page[0]?.total_count ?? total);
    } catch (failure) {
      if (mine === generation.current) setError(errorKey(failure));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, key, loading, loadingMore, total]);

  // A row that was decided leaves the list at once; the next page then starts one earlier.
  const remove = useCallback((id: string) => {
    rowsRef.current = rowsRef.current.filter((row) => row.id !== id);
    setRows(rowsRef.current);
    setTotal((current) => Math.max(0, current - 1));
  }, []);

  const patch = useCallback((id: string, values: Partial<CatalogRow>) => {
    rowsRef.current = rowsRef.current.map((row) => (row.id === id ? { ...row, ...values } : row));
    setRows(rowsRef.current);
  }, []);

  return { rows, total, loading, loadingMore, error, reload, loadMore, remove, patch };
}
