import { useQuery } from "@tanstack/react-query";
import { getUserParties, UserPartyInfo } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function useUserParties() {
  const { user, loading: authLoading } = useAuth();

  const {
    data: parties = [],
    isLoading,
    error,
    refetch,
  } = useQuery<UserPartyInfo[]>({
    queryKey: ["userParties", user?.id],
    queryFn: getUserParties,
    enabled: !!user && !authLoading,
    staleTime: 1000 * 60, // 1 minute
    refetchOnWindowFocus: true,
  });

  return {
    parties,
    loading: authLoading || isLoading,
    error,
    refetch,
  };
}
