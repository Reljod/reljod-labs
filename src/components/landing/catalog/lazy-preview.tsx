"use client";

import { useEffect, useRef, useState } from "react";
import { IconTile } from "@/components/ui/icon";
import type { Project } from "@/content/types";
import { demoPreviews } from "../demo-previews";

/** Mounts a demo's moving preview only once it comes near the screen, then keeps it. */
export function LazyPreview({ demo }: { demo: Project }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return (
    <div ref={ref}>
      {near ? (
        demoPreviews[demo.slug]?.(demo)
      ) : (
        <div className="flex aspect-[960/726] items-center justify-center bg-marble">
          <IconTile name={demo.icon} />
        </div>
      )}
    </div>
  );
}
