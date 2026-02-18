"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useRecap } from "@/hooks/use-recap";
import { useProducts } from "@/hooks/use-products";
import { useUnits } from "@/hooks/use-units";
import { DatePicker } from "@/components/recap/date-picker";
import { AddOrderDialog } from "@/components/recap/add-order-dialog";
import { PartnerCard } from "@/components/recap/partner-card";

export function RecapView() {
  const [selectedDate, setSelectedDate] = useState(() =>
    format(new Date(), "yyyy-MM-dd"),
  );

  const recap = useRecap(selectedDate);
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: units, isLoading: unitsLoading } = useUnits();

  const isLoading = recap.isLoading || productsLoading || unitsLoading;
  const groups = recap.data || [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            data-testid="recap-heading"
          >
            Recap
          </h1>
          <p className="text-sm text-muted-foreground">
            Daily pre-orders overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
          <AddOrderDialog date={selectedDate} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">No orders for this date</p>
        </div>
      ) : (
        <div>
          {groups.map((group) => (
            <PartnerCard
              key={group.partner.id}
              partner={group.partner}
              preOrders={group.pre_orders}
              date={selectedDate}
              products={products || []}
              units={units || []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
