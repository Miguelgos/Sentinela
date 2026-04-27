import { useQuery } from "@tanstack/react-query";

export function useAnalysisData<T>(fetcher: () => Promise<T>, queryKey?: string[]) {
  const key = queryKey ?? [fetcher.toString()];

  const { data = null, isLoading, error, refetch } = useQuery<T>({
    queryKey: key,
    queryFn: fetcher,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    data:    data ?? null,
    loading: isLoading,
    error:   error ? String(error) : null,
    reload:  () => { void refetch(); },
  };
}
