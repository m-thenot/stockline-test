"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderCard } from "@/components/recap/order-card";
import type { Partner, PreOrder, Product, Unit } from "@/lib/types";

interface PartnerCardProps {
  partner: Partner;
  preOrders: PreOrder[];
  date: string;
  products: Product[];
  units: Unit[];
}

export function PartnerCard({
  partner,
  preOrders,
  date,
  products,
  units,
}: PartnerCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card
      className="mb-4"
      data-testid="partner-card"
      data-partner-id={partner.id}
    >
      <CardHeader
        className="flex flex-row items-center gap-3 cursor-pointer select-none pb-3 pt-4 px-4"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <CardTitle className="text-base">{partner.name}</CardTitle>
        {partner.code && (
          <Badge variant="outline" className="text-xs">
            {partner.code}
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs">
          {preOrders.length} order{preOrders.length !== 1 ? "s" : ""}
        </Badge>
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-4 pt-0">
          {preOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              date={date}
              products={products}
              units={units}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
