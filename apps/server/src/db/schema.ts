import { sqliteTable, integer, text, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const components = sqliteTable("components", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull().default(0),
  spec: text("spec"),
  price: text("price"),
  color: text("color"),
  purchaseUrl: text("purchase_url"),
  imagePath: text("image_path"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const componentTags = sqliteTable(
  "component_tags",
  {
    componentId: integer("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.componentId, t.tagId] })],
);

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const planItems = sqliteTable("plan_items", {
  id: integer("id").primaryKey(),
  planId: integer("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  componentId: integer("component_id")
    .notNull()
    .references(() => components.id, { onDelete: "cascade" }),
  quantityPer: integer("quantity_per").notNull(),
});

export const stockMovements = sqliteTable("stock_movements", {
  id: integer("id").primaryKey(),
  componentId: integer("component_id")
    .notNull()
    .references(() => components.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason"),
  planId: integer("plan_id").references(() => plans.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
});
