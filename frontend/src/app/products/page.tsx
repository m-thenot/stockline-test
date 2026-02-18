"use client";

import { useProducts } from "@/hooks/use-products";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProductsPage() {
  const { data: products, isLoading } = useProducts();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse the product catalog
          </p>
        </div>
        {!isLoading && products && products.length > 0 && (
          <div className="rounded-lg bg-muted/50 px-4 py-2">
            <span className="text-sm font-medium text-muted-foreground">
              {products.length} product{products.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-sm transition-shadow hover:shadow-md">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Short Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products && products.length > 0 ? (
                products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium text-foreground">
                      {product.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.short_name || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.sku || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.code || "-"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No products found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
