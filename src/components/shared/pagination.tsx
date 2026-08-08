"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

export function Pagination({ page, pageCount, onPageChange, totalItems }: { page: number; pageCount: number; onPageChange: (page: number) => void; totalItems: number }) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {pageCount} · {totalItems} total
      </p>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
