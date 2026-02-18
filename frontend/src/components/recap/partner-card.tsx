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
      className="overflow-hidden transition-shadow hover:shadow-md"
      data-testid="partner-card"
      data-partner-id={partner.id}
    >
      <CardHeader
        className="flex cursor-pointer select-none flex-row items-baseline gap-3 px-6 py-5"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        )}
        <CardTitle className="text-lg">{partner.name}</CardTitle>
        {partner.code && (
          <Badge variant="outline" className="text-xs font-normal">
            {partner.code}
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs font-normal">
          {preOrders.length} order{preOrders.length !== 1 ? "s" : ""}
        </Badge>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 px-6 pb-6 pt-0">
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
