"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecap } from "@/hooks/use-recap";
import { usePartners } from "@/hooks/use-partners";

interface AddOrderDialogProps {
  date: string;
}

export function AddOrderDialog({ date }: AddOrderDialogProps) {
  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(date);
  const [comment, setComment] = useState("");

  const { createPreOrder } = useRecap(date);
  const { data: partners } = usePartners();

  useEffect(() => {
    setDeliveryDate(date);
  }, [date]);

  const handleSubmit = () => {
    if (!partnerId || !deliveryDate) return;

    createPreOrder.mutate(
      {
        partner_id: partnerId,
        delivery_date: deliveryDate,
        comment: comment || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setPartnerId("");
          setDeliveryDate(date);
          setComment("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add Order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Pre-Order</DialogTitle>
          <DialogDescription>
            Create a new pre-order for the selected date.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Partner</label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a partner" />
              </SelectTrigger>
              <SelectContent>
                {partners?.map((partner) => (
                  <SelectItem key={partner.id} value={partner.id}>
                    {partner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Delivery Date</label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Comment (optional)</label>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!partnerId || !deliveryDate || createPreOrder.isPending}
          >
            Create Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
