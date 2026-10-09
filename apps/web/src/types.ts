export interface Tag {
  id: number;
  name: string;
  componentCount: number;
}

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
  componentCount: number;
}

export interface ComponentTag {
  id: number;
  name: string;
}

export interface ComponentItem {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  quantity: number;
  spec: string | null;
  /** 单价（元，两位小数字符串） */
  price: string | null;
  color: string | null;
  purchaseUrl: string | null;
  /** 相对路径，如 /uploads/xxx.jpg */
  imagePath: string | null;
  note: string | null;
  updatedAt: string;
  tags: ComponentTag[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatsOverview {
  summary: {
    /** 物品种类数 */
    kinds: number;
    /** 总数量 */
    totalQuantity: number;
    /** 总价值（元，两位小数字符串） */
    totalValue: string;
  };
  categoryDistribution: {
    id: number | null;
    name: string;
    kinds: number;
    quantity: number;
  }[];
  tagDistribution: { id: number; name: string; count: number }[];
  lowStock: {
    id: number;
    name: string;
    categoryName: string | null;
    quantity: number;
    spec: string | null;
    price: string | null;
    imagePath: string | null;
  }[];
  recent: {
    id: number;
    name: string;
    categoryName: string | null;
    quantity: number;
    price: string | null;
    imagePath: string | null;
    updatedAt: string;
  }[];
}

export interface TrashItem {
  id: number;
  name: string;
  categoryName: string | null;
  quantity: number;
  spec: string | null;
  price: string | null;
  imagePath: string | null;
  deletedAt: string;
  /** 距自动清理剩余天数 */
  daysLeft: number;
}

export interface ComponentMovement {
  id: number;
  delta: number;
  reason: string | null;
  createdAt: string;
}

export interface CsvImportReport {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PlanSummary {
  id: number;
  name: string;
  description: string | null;
  /** 明细物品种数（不含回收站物品） */
  itemCount: number;
  /** 当前可行份数；无明细时为 null */
  feasible: number | null;
  /** 1 份总价（元，两位小数字符串） */
  totalCost1: string;
  /** 目标 1 份时的缺料物品数 */
  shortageCount: number;
  updatedAt: string;
}

export interface PlanDetailItem {
  id: number;
  componentId: number;
  name: string;
  spec: string | null;
  categoryName: string | null;
  quantityPer: number;
  quantity: number;
  price: string | null;
  purchaseUrl: string | null;
  imagePath: string | null;
  /** 物品是否已在回收站（不参与方案计算） */
  inTrash: boolean;
}

export interface PlanDetail {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlanDetailItem[];
}

export interface ShortageEntry {
  componentId: number;
  name: string;
  quantityPer: number;
  quantity: number;
  need: number;
  shortage: number;
  price: string | null;
  purchaseUrl: string | null;
}

export interface Feasibility {
  copies: number;
  /** 当前可行份数；无明细时为 null */
  feasible: number | null;
  /** 1 份总价 */
  totalCost1: string;
  /** 目标份数总价 */
  totalCostCopies: string;
  /** 缺料补齐预估花费 */
  shortageCost: string;
  /** 缺料清单（按缺少量降序） */
  shortages: ShortageEntry[];
  /** 已在回收站、未参与计算的物品名 */
  trashItems: string[];
}
