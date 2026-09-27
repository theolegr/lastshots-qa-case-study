import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div className="min-h-screen flex flex-col px-6 py-8 animate-in fade-in duration-300">
      {/* Header skeleton */}
      <Skeleton className="h-5 w-20 mb-8" />

      {/* Title area */}
      <div className="mb-10">
        <Skeleton className="w-16 h-16 rounded-full mb-4" />
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Content blocks */}
      <div className="space-y-4 flex-1">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      {/* Bottom button */}
      <Skeleton className="h-14 w-full rounded-xl mt-6" />
    </div>
  );
}
