import { useEffect, useState, useCallback } from "react";
import { fetchCatalog, type MissionControlCatalog } from "@/lib/missionControlCatalog";

export function useMissionControlCatalog() {
  const [data, setData] = useState<MissionControlCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const cat = await fetchCatalog({ force });
      setData(cat);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  return { catalog: data, loading, error, refresh: () => load(true) };
}
