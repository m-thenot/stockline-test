"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import type { Product, Unit } from "@/lib/types";

interface AddFlowFormProps {
  preOrderId: string;
  date: string;
  products: Product[];
  units: Unit[];
}

export function AddFlowForm({
  preOrderId,
  date,
  products,
  units,
}: AddFlowFormProps) {
  const { createFlow } = useRecap(date);

  const orderIdSuffix = preOrderId.slice(-8);

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");

  const handleSubmit = () => {
    if (!productId || !quantity || !unitId || !price) return;

    const quantityNum = parseFloat(quantity);
    const priceNum = parseFloat(price);
    if (isNaN(quantityNum) || isNaN(priceNum)) return;

    createFlow.mutate(
      {
        preOrderId,
        data: {
          product_id: productId,
          quantity: quantityNum,
          unit_id: unitId,
          price: priceNum,
        },
      },
      {
        onSuccess: () => {
          setProductId("");
          setQuantity("");
          setUnitId("");
          setPrice("");
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-2 border-t pt-2 mt-2">
      <div className="w-[200px]">
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger
            className="h-8 text-xs"
            data-testid={`add-flow-product-select-${orderIdSuffix}`}
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
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="h-8 text-xs"
          placeholder="Qty"
          data-testid={`add-flow-quantity-input-${orderIdSuffix}`}
        />
      </div>
      <div className="w-[120px]">
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger
            className="h-8 text-xs"
            data-testid={`add-flow-unit-select-${orderIdSuffix}`}
          >
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
          onChange={(e) => setPrice(e.target.value)}
          className="h-8 text-xs"
          placeholder="Price"
          step="0.01"
          data-testid={`add-flow-price-input-${orderIdSuffix}`}
        />
      </div>
      <div className="flex-1" />
      <Button
        size="sm"
        className="h-8"
        onClick={handleSubmit}
        disabled={
          !productId || !quantity || !unitId || !price || createFlow.isPending
        }
        data-testid={`add-flow-button-${orderIdSuffix}`}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add
      </Button>
    </div>
  );
}
