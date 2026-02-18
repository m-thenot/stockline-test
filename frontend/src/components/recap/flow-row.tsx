"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecap } from "@/hooks/use-recap";
import type { PreOrderFlow, Product, Unit } from "@/lib/types";

interface FlowRowProps {
  flow: PreOrderFlow;
  date: string;
  products: Product[];
  units: Unit[];
}

type Draft = { quantity: string; price: string; comment: string };

export function FlowRow({ flow, date, products, units }: FlowRowProps) {
  const { updateFlow, deleteFlow } = useRecap(date);

  const [draft, setDraft] = useState<Draft>(() => ({
    quantity: String(flow.quantity),
    price: String(flow.price),
    comment: flow.comment ?? "",
  }));

  const isEditingRef = useRef(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // TODO: should be refactored / updating a field prevent receiving the latest value from another field
    if (isEditingRef.current) return;

    const nextDraft = {
      quantity: String(flow.quantity),
      price: String(flow.price),
      comment: flow.comment ?? "",
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((prev) => {
      if (
        prev.quantity === nextDraft.quantity &&
        prev.price === nextDraft.price &&
        prev.comment === nextDraft.comment
      ) {
        return prev;
      }

      return nextDraft;
    });
  }, [flow.quantity, flow.price, flow.comment]);

  const debouncedUpdate = (data: Record<string, unknown>) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      updateFlow.mutate({ id: flow.id, data });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleProductChange = (productId: string) => {
    updateFlow.mutate({ id: flow.id, data: { product_id: productId } });
  };

  const handleUnitChange = (unitId: string) => {
    updateFlow.mutate({ id: flow.id, data: { unit_id: unitId } });
  };

  const handleQuantityChange = (value: string) => {
    setDraft((prev) => ({ ...prev, quantity: value }));
    const num = parseFloat(value);
    if (!isNaN(num)) {
      debouncedUpdate({ quantity: num });
    }
  };

  const handlePriceChange = (value: string) => {
    setDraft((prev) => ({ ...prev, price: value }));
    const num = parseFloat(value);
    if (!isNaN(num)) {
      debouncedUpdate({ price: num });
    }
  };

  const handleCommentChange = (value: string) => {
    setDraft((prev) => ({ ...prev, comment: value }));
    debouncedUpdate({ comment: value });
  };

  const handleDelete = () => {
    deleteFlow.mutate(flow.id);
  };

  return (
    <div
      className="flex items-center gap-2 py-1.5"
      data-testid="flow-row"
      data-flow-id={flow.id}
    >
      <div className="w-[200px]">
        <Select value={flow.product_id} onValueChange={handleProductChange}>
          <SelectTrigger
            className="h-8 text-xs"
            data-testid="flow-product-select"
          >
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-[80px]">
        <Input
          type="number"
          value={draft.quantity}
          onChange={(e) => handleQuantityChange(e.target.value)}
          onFocus={() => (isEditingRef.current = true)}
          onBlur={() => (isEditingRef.current = false)}
          className="h-8 text-xs"
          placeholder="Qty"
          data-testid="flow-quantity-input"
        />
      </div>
      <div className="w-[120px]">
        <Select value={flow.unit_id} onValueChange={handleUnitChange}>
          <SelectTrigger className="h-8 text-xs" data-testid="flow-unit-select">
            <SelectValue placeholder="Unit" />
          </SelectTrigger>
          <SelectContent>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.name} ({unit.abbreviation})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-[90px]">
        <Input
          type="number"
          value={draft.price}
          onChange={(e) => handlePriceChange(e.target.value)}
          onFocus={() => (isEditingRef.current = true)}
          onBlur={() => (isEditingRef.current = false)}
          className="h-8 text-xs"
          placeholder="Price"
          step="0.01"
          data-testid="flow-price-input"
        />
      </div>
      <div className="flex-1">
        <Input
          value={draft.comment}
          onChange={(e) => handleCommentChange(e.target.value)}
          onFocus={() => (isEditingRef.current = true)}
          onBlur={() => (isEditingRef.current = false)}
          className="h-8 text-xs"
          placeholder="Comment"
          data-testid="flow-comment-input"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        data-testid="flow-delete-button"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
