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

export function FlowRow({ flow, date, products, units }: FlowRowProps) {
  const { updateFlow, deleteFlow } = useRecap(date);

  const [quantity, setQuantity] = useState(String(flow.quantity));
  const [price, setPrice] = useState(String(flow.price));
  const [comment, setComment] = useState(flow.comment || "");

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const mutateRef = useRef(updateFlow.mutate);
  mutateRef.current = updateFlow.mutate;

  const debouncedUpdate = (data: Record<string, unknown>) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      mutateRef.current({ id: flow.id, data });
    }, 500);
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
    setQuantity(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      debouncedUpdate({ quantity: num });
    }
  };

  const handlePriceChange = (value: string) => {
    setPrice(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      debouncedUpdate({ price: num });
    }
  };

  const handleCommentChange = (value: string) => {
    setComment(value);
    debouncedUpdate({ comment: value });
  };

  const handleDelete = () => {
    deleteFlow.mutate(flow.id);
  };

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-[200px]">
        <Select value={flow.product_id} onValueChange={handleProductChange}>
          <SelectTrigger className="h-8 text-xs">
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
          value={quantity}
          onChange={(e) => handleQuantityChange(e.target.value)}
          className="h-8 text-xs"
          placeholder="Qty"
        />
      </div>
      <div className="w-[120px]">
        <Select value={flow.unit_id} onValueChange={handleUnitChange}>
          <SelectTrigger className="h-8 text-xs">
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
          value={price}
          onChange={(e) => handlePriceChange(e.target.value)}
          className="h-8 text-xs"
          placeholder="Price"
          step="0.01"
        />
      </div>
      <div className="flex-1">
        <Input
          value={comment}
          onChange={(e) => handleCommentChange(e.target.value)}
          className="h-8 text-xs"
          placeholder="Comment"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
