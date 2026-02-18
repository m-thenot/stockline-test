"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useRecap } from "@/hooks/use-recap";
import { FlowRow } from "@/components/recap/flow-row";
import { AddFlowForm } from "@/components/recap/add-flow-form";
import type { PreOrder, Product, Unit } from "@/lib/types";

interface OrderCardProps {
  order: PreOrder;
  date: string;
  products: Product[];
  units: Unit[];
}

export function OrderCard({ order, date, products, units }: OrderCardProps) {
  const { updatePreOrder, deletePreOrder } = useRecap(date);

  const handleToggleStatus = () => {
    const newStatus = order.status === 0 ? 1 : 0;
    updatePreOrder.mutate({ id: order.id, data: { status: newStatus } });
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this order?")) {
      deletePreOrder.mutate(order.id);
    }
  };

  const orderIdSuffix = order.id.slice(-8);

  return (
    <Card
      className="border-muted/50 bg-muted/30"
      data-testid="order-card"
      data-order-id={order.id}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5 py-4">
        <div className="flex items-center gap-3">
          <Badge
            className="cursor-pointer select-none"
            variant={order.status === 1 ? "default" : "secondary"}
            onClick={handleToggleStatus}
            data-testid={`order-status-badge-${orderIdSuffix}`}
          >
            {order.status === 1 ? "Confirmed" : "Pending"}
          </Badge>
          {order.comment && (
            <span className="text-sm text-muted-foreground">
              {order.comment}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
          data-testid="order-delete-button"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        {order.flows.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 pb-2 text-xs font-medium text-muted-foreground">
              <div className="w-[200px]">Product</div>
              <div className="w-[80px]">Qty</div>
              <div className="w-[120px]">Unit</div>
              <div className="w-[90px]">Price</div>
              <div className="flex-1">Comment</div>
              <div className="w-8" />
            </div>
            {order.flows.map((flow) => (
              <FlowRow
                key={flow.id}
                flow={flow}
                date={date}
                products={products}
                units={units}
              />
            ))}
          </div>
        )}
        <AddFlowForm
          preOrderId={order.id}
          date={date}
          products={products}
          units={units}
        />
      </CardContent>
    </Card>
  );
}
