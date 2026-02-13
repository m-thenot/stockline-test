export interface Product {
  id: string;
  name: string;
  short_name: string | null;
  sku: string | null;
  code: string | null;
}

export interface Partner {
  id: string;
  name: string;
  code: string | null;
  type: number; // 1=client, 2=supplier
}

export interface Unit {
  id: string;
  name: string;
  abbreviation: string;
}

export interface PreOrderFlow {
  id: string;
  pre_order_id: string;
  product_id: string;
  quantity: number;
  price: number;
  unit_id: string;
  comment: string | null;
  created_at: string | null;
  updated_at: string | null;
  product: Product | null;
  unit: Unit | null;
}

export interface PreOrder {
  id: string;
  partner_id: string;
  status: number; // 0=pending, 1=confirmed
  order_date: string | null;
  delivery_date: string;
  comment: string | null;
  created_at: string | null;
  updated_at: string | null;
  partner: Partner | null;
  flows: PreOrderFlow[];
}

export interface RecapGroup {
  partner: Partner;
  pre_orders: PreOrder[];
}
