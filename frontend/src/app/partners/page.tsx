"use client";

import { usePartners } from "@/hooks/use-partners";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMemo } from "react";

export default function PartnersPage() {
  const { data, isLoading } = usePartners();
  const partners = useMemo(
    () => data?.sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const clientsCount = partners?.filter((p) => p.type === 1).length || 0;
  const suppliersCount = partners?.filter((p) => p.type === 2).length || 0;

  const allPartners = partners || [];
  const clients = partners?.filter((p) => p.type === 1) || [];
  const suppliers = partners?.filter((p) => p.type === 2) || [];

  const renderTable = (partnerList: typeof partners) => (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-sm transition-shadow hover:shadow-md">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partnerList && partnerList.length > 0 ? (
            partnerList.map((partner) => (
              <TableRow key={partner.id}>
                <TableCell className="font-medium text-foreground">
                  {partner.name}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {partner.code || "-"}
                </TableCell>
                <TableCell>
                  <Badge variant={partner.type === 1 ? "default" : "secondary"}>
                    {partner.type === 1 ? "Client" : "Supplier"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="h-32 text-center text-muted-foreground"
              >
                No partners found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Partners</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse clients and suppliers
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <Tabs defaultValue="all" className="w-full">
          <TabsList variant="line" className="w-full">
            <TabsTrigger variant="line" value="all">
              All ({allPartners.length})
            </TabsTrigger>
            <TabsTrigger variant="line" value="clients">
              Clients ({clientsCount})
            </TabsTrigger>
            <TabsTrigger variant="line" value="suppliers">
              Suppliers ({suppliersCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">{renderTable(allPartners)}</TabsContent>
          <TabsContent value="clients">{renderTable(clients)}</TabsContent>
          <TabsContent value="suppliers">{renderTable(suppliers)}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
