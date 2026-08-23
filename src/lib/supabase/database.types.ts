export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip: unknown
          restaurant_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: unknown
          restaurant_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: unknown
          restaurant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          available_from: string | null
          available_to: string | null
          created_at: string
          days_of_week: number[] | null
          id: string
          name: string
          restaurant_id: string
          sort_order: number
          station: Database["public"]["Enums"]["station"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
          station?: Database["public"]["Enums"]["station"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
          station?: Database["public"]["Enums"]["station"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_blocks: {
        Row: {
          config: Json
          created_at: string
          days_of_week: number[] | null
          id: string
          is_hidden: boolean
          layout_id: string
          parent_block_id: string | null
          restaurant_id: string
          sort_order: number
          type: Database["public"]["Enums"]["menu_block_type"]
          updated_at: string
          visible_from: string | null
          visible_to: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          is_hidden?: boolean
          layout_id: string
          parent_block_id?: string | null
          restaurant_id: string
          sort_order?: number
          type: Database["public"]["Enums"]["menu_block_type"]
          updated_at?: string
          visible_from?: string | null
          visible_to?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          is_hidden?: boolean
          layout_id?: string
          parent_block_id?: string | null
          restaurant_id?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["menu_block_type"]
          updated_at?: string
          visible_from?: string | null
          visible_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_blocks_layout_id_restaurant_id_fkey"
            columns: ["layout_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_layouts"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_blocks_parent_block_id_fkey"
            columns: ["parent_block_id"]
            isOneToOne: false
            referencedRelation: "menu_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_blocks_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["menu_event_type"]
          guest_id: string | null
          id: string
          product_id: string
          restaurant_id: string
          session_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["menu_event_type"]
          guest_id?: string | null
          id?: string
          product_id: string
          restaurant_id: string
          session_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["menu_event_type"]
          guest_id?: string | null
          id?: string
          product_id?: string
          restaurant_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_events_guest_id_restaurant_id_fkey"
            columns: ["guest_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_events_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_events_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_events_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      menu_layouts: {
        Row: {
          created_at: string
          id: string
          published_at: string | null
          published_by: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["menu_layout_status"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["menu_layout_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["menu_layout_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_layouts_published_by_restaurant_id_fkey"
            columns: ["published_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "menu_layouts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          id: string
          is_required: boolean
          max_select: number
          min_select: number
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          group_id: string
          id: string
          is_available: boolean
          name: string
          price_delta_cents: number
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          group_id: string
          id?: string
          is_available?: boolean
          name: string
          price_delta_cents?: number
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          group_id?: string
          id?: string
          is_available?: boolean
          name?: string
          price_delta_cents?: number
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_options_group_id_restaurant_id_fkey"
            columns: ["group_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "modifier_options_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          created_at: string
          group_name: string
          id: string
          option_name: string
          order_item_id: string
          price_delta_cents: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_name: string
          id?: string
          option_name: string
          order_item_id: string
          price_delta_cents?: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_name?: string
          id?: string
          option_name?: string
          order_item_id?: string
          price_delta_cents?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_order_item_id_restaurant_id_fkey"
            columns: ["order_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "order_item_timings"
            referencedColumns: ["order_item_id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_restaurant_id_fkey"
            columns: ["order_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_item_modifiers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          course: number
          created_at: string
          delivered_at: string | null
          guest_id: string | null
          id: string
          notes: string | null
          order_id: string
          original_price_cents: number | null
          product_id: string
          promotion_id: string | null
          qty: number
          queued_at: string | null
          ready_at: string | null
          rejection_reason:
            | Database["public"]["Enums"]["rejection_reason"]
            | null
          restaurant_id: string
          started_at: string | null
          station: Database["public"]["Enums"]["station"]
          status: Database["public"]["Enums"]["order_item_status"]
          total_price_cents: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          course?: number
          created_at?: string
          delivered_at?: string | null
          guest_id?: string | null
          id?: string
          notes?: string | null
          order_id: string
          original_price_cents?: number | null
          product_id: string
          promotion_id?: string | null
          qty: number
          queued_at?: string | null
          ready_at?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["rejection_reason"]
            | null
          restaurant_id: string
          started_at?: string | null
          station: Database["public"]["Enums"]["station"]
          status?: Database["public"]["Enums"]["order_item_status"]
          total_price_cents: number
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          course?: number
          created_at?: string
          delivered_at?: string | null
          guest_id?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          original_price_cents?: number | null
          product_id?: string
          promotion_id?: string | null
          qty?: number
          queued_at?: string | null
          ready_at?: string | null
          rejection_reason?:
            | Database["public"]["Enums"]["rejection_reason"]
            | null
          restaurant_id?: string
          started_at?: string | null
          station?: Database["public"]["Enums"]["station"]
          status?: Database["public"]["Enums"]["order_item_status"]
          total_price_cents?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_guest_id_restaurant_id_fkey"
            columns: ["guest_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_promotion_id_restaurant_id_fkey"
            columns: ["promotion_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "live_promotions"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_promotion_id_restaurant_id_fkey"
            columns: ["promotion_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by_staff_id: string | null
          guest_id: string | null
          id: string
          idempotency_key: string
          restaurant_id: string
          session_id: string
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          guest_id?: string | null
          id?: string
          idempotency_key: string
          restaurant_id: string
          session_id: string
          source: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          guest_id?: string | null
          id?: string
          idempotency_key?: string
          restaurant_id?: string
          session_id?: string
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_approved_by_restaurant_id_fkey"
            columns: ["approved_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_created_by_staff_id_restaurant_id_fkey"
            columns: ["created_by_staff_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_guest_id_restaurant_id_fkey"
            columns: ["guest_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_guests"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "orders_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          restaurant_id: string
          session_id: string
          tendered_cents: number | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          restaurant_id: string
          session_id: string
          tendered_cents?: number | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["payment_method"]
          restaurant_id?: string
          session_id?: string
          tendered_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_restaurant_id_fkey"
            columns: ["created_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "payments_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      product_modifier_groups: {
        Row: {
          created_at: string
          group_id: string
          id: string
          product_id: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          product_id: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          product_id?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_groups_group_id_restaurant_id_fkey"
            columns: ["group_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "product_modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          auto_reactivate_at: string | null
          badges: Database["public"]["Enums"]["product_badge"][]
          category_id: string
          created_at: string
          description: string | null
          diet_tags: Database["public"]["Enums"]["diet_tag"][]
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          prep_minutes: number
          price_cents: number
          restaurant_id: string
          serves_people: number
          sort_order: number
          station_override: Database["public"]["Enums"]["station"] | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          auto_reactivate_at?: string | null
          badges?: Database["public"]["Enums"]["product_badge"][]
          category_id: string
          created_at?: string
          description?: string | null
          diet_tags?: Database["public"]["Enums"]["diet_tag"][]
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          prep_minutes?: number
          price_cents: number
          restaurant_id: string
          serves_people?: number
          sort_order?: number
          station_override?: Database["public"]["Enums"]["station"] | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          auto_reactivate_at?: string | null
          badges?: Database["public"]["Enums"]["product_badge"][]
          category_id?: string
          created_at?: string
          description?: string | null
          diet_tags?: Database["public"]["Enums"]["diet_tag"][]
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          prep_minutes?: number
          price_cents?: number
          restaurant_id?: string
          serves_people?: number
          sort_order?: number
          station_override?: Database["public"]["Enums"]["station"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_restaurant_id_fkey"
            columns: ["category_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "products_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          permissions: string[]
          pin_failed_attempts: number
          pin_hash: string | null
          pin_locked_until: string | null
          restaurant_id: string
          roles: Database["public"]["Enums"]["staff_role"][]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          name: string
          permissions?: string[]
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          restaurant_id: string
          roles?: Database["public"]["Enums"]["staff_role"][]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          permissions?: string[]
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          restaurant_id?: string
          roles?: Database["public"]["Enums"]["staff_role"][]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_targets: {
        Row: {
          created_at: string
          id: string
          promotion_id: string
          restaurant_id: string
          target_id: string
          target_type: Database["public"]["Enums"]["promotion_target_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          promotion_id: string
          restaurant_id: string
          target_id: string
          target_type: Database["public"]["Enums"]["promotion_target_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          promotion_id?: string
          restaurant_id?: string
          target_id?: string
          target_type?: Database["public"]["Enums"]["promotion_target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_targets_promotion_id_restaurant_id_fkey"
            columns: ["promotion_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "live_promotions"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "promotion_targets_promotion_id_restaurant_id_fkey"
            columns: ["promotion_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "promotion_targets_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          applies_to: Database["public"]["Enums"]["promotion_applies_to"]
          badge_color: string | null
          badge_label: string | null
          buy_quantity: number | null
          created_at: string
          created_by: string | null
          days_of_week: number[] | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number | null
          ends_at: string | null
          id: string
          is_stackable: boolean
          max_quantity: number | null
          min_order_cents: number | null
          name: string
          pay_quantity: number | null
          priority: number
          restaurant_id: string
          starts_at: string | null
          status: Database["public"]["Enums"]["promotion_status"]
          time_from: string | null
          time_to: string | null
          updated_at: string
          used_quantity: number
        }
        Insert: {
          applies_to?: Database["public"]["Enums"]["promotion_applies_to"]
          badge_color?: string | null
          badge_label?: string | null
          buy_quantity?: number | null
          created_at?: string
          created_by?: string | null
          days_of_week?: number[] | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value?: number | null
          ends_at?: string | null
          id?: string
          is_stackable?: boolean
          max_quantity?: number | null
          min_order_cents?: number | null
          name: string
          pay_quantity?: number | null
          priority?: number
          restaurant_id: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["promotion_status"]
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          used_quantity?: number
        }
        Update: {
          applies_to?: Database["public"]["Enums"]["promotion_applies_to"]
          badge_color?: string | null
          badge_label?: string | null
          buy_quantity?: number | null
          created_at?: string
          created_by?: string | null
          days_of_week?: number[] | null
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number | null
          ends_at?: string | null
          id?: string
          is_stackable?: boolean
          max_quantity?: number | null
          min_order_cents?: number | null
          name?: string
          pay_quantity?: number | null
          priority?: number
          restaurant_id?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["promotion_status"]
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          used_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          active: boolean
          area: string
          created_at: string
          id: string
          label: string
          restaurant_id: string
          seats: number
          short_code: string
          tag_uid: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          label: string
          restaurant_id: string
          seats?: number
          short_code?: string
          tag_uid?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          label?: string
          restaurant_id?: string
          seats?: number
          short_code?: string
          tag_uid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          active: boolean
          brand_color: string
          created_at: string
          currency: string
          id: string
          logo_url: string | null
          name: string
          require_phone: boolean
          require_waiter_to_open_table: boolean
          service_fee_pct: number
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_color?: string
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          require_phone?: boolean
          require_waiter_to_open_table?: boolean
          service_fee_pct?: number
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_color?: string
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          require_phone?: boolean
          require_waiter_to_open_table?: boolean
          service_fee_pct?: number
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_adjustments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          percent: number | null
          reason: string
          restaurant_id: string
          session_id: string
          type: Database["public"]["Enums"]["adjustment_type"]
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          created_by: string
          id?: string
          percent?: number | null
          reason: string
          restaurant_id: string
          session_id: string
          type: Database["public"]["Enums"]["adjustment_type"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          percent?: number | null
          reason?: string
          restaurant_id?: string
          session_id?: string
          type?: Database["public"]["Enums"]["adjustment_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_adjustments_created_by_restaurant_id_fkey"
            columns: ["created_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "session_adjustments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_adjustments_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "session_adjustments_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      session_guests: {
        Row: {
          created_at: string
          device_hash: string | null
          display_name: string
          id: string
          joined_at: string
          lgpd_consent_at: string | null
          phone: string | null
          restaurant_id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_hash?: string | null
          display_name: string
          id?: string
          joined_at?: string
          lgpd_consent_at?: string | null
          phone?: string | null
          restaurant_id: string
          session_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_hash?: string | null
          display_name?: string
          id?: string
          joined_at?: string
          lgpd_consent_at?: string | null
          phone?: string | null
          restaurant_id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_guests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_guests_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "session_guests_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          closed_at: string | null
          created_at: string
          force_released: boolean
          guest_count: number | null
          id: string
          notes: string | null
          opened_at: string
          release_note: string | null
          release_reason: Database["public"]["Enums"]["release_reason"] | null
          released_at: string | null
          released_by: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["session_status"]
          table_id: string
          updated_at: string
          waiter_id: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          force_released?: boolean
          guest_count?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          release_note?: string | null
          release_reason?: Database["public"]["Enums"]["release_reason"] | null
          released_at?: string | null
          released_by?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["session_status"]
          table_id: string
          updated_at?: string
          waiter_id?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          force_released?: boolean
          guest_count?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          release_note?: string | null
          release_reason?: Database["public"]["Enums"]["release_reason"] | null
          released_at?: string | null
          released_by?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["session_status"]
          table_id?: string
          updated_at?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_released_by_restaurant_id_fkey"
            columns: ["released_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_status"
            referencedColumns: ["table_id", "restaurant_id"]
          },
          {
            foreignKeyName: "table_sessions_waiter_id_restaurant_id_fkey"
            columns: ["waiter_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          created_at: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          restaurant_id: string
          session_id: string
          status: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
          type: Database["public"]["Enums"]["waiter_call_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id: string
          session_id: string
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id: string
          type: Database["public"]["Enums"]["waiter_call_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id?: string
          session_id?: string
          status?: Database["public"]["Enums"]["waiter_call_status"]
          table_id?: string
          type?: Database["public"]["Enums"]["waiter_call_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_resolved_by_restaurant_id_fkey"
            columns: ["resolved_by", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "waiter_calls_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id", "restaurant_id"]
          },
          {
            foreignKeyName: "waiter_calls_session_id_restaurant_id_fkey"
            columns: ["session_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_status"
            referencedColumns: ["table_id", "restaurant_id"]
          },
        ]
      }
    }
    Views: {
      live_promotions: {
        Row: {
          applies_to: Database["public"]["Enums"]["promotion_applies_to"] | null
          badge_color: string | null
          badge_label: string | null
          buy_quantity: number | null
          days_of_week: number[] | null
          discount_type: Database["public"]["Enums"]["discount_type"] | null
          discount_value: number | null
          ends_at: string | null
          id: string | null
          is_stackable: boolean | null
          max_quantity: number | null
          min_order_cents: number | null
          name: string | null
          pay_quantity: number | null
          priority: number | null
          remaining_quantity: number | null
          restaurant_id: string | null
          time_from: string | null
          time_to: string | null
          timezone: string | null
          used_quantity: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_timings: {
        Row: {
          delivered_at: string | null
          fila_seconds: number | null
          is_late: boolean | null
          order_item_id: string | null
          prep_minutes: number | null
          producao_seconds: number | null
          product_id: string | null
          product_name: string | null
          queued_at: string | null
          ready_at: string | null
          restaurant_id: string | null
          session_id: string | null
          started_at: string | null
          station: Database["public"]["Enums"]["station"] | null
          status: Database["public"]["Enums"]["order_item_status"] | null
          total_seconds: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_totals: {
        Row: {
          balance_cents: number | null
          discount_cents: number | null
          paid_cents: number | null
          pending_cents: number | null
          promotion_discount_cents: number | null
          restaurant_id: string | null
          service_fee_cents: number | null
          service_fee_pct: number | null
          service_fee_waived: boolean | null
          session_id: string | null
          status: Database["public"]["Enums"]["session_status"] | null
          subtotal_cents: number | null
          table_id: string | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_restaurant_id_fkey"
            columns: ["table_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "table_status"
            referencedColumns: ["table_id", "restaurant_id"]
          },
        ]
      }
      table_status: {
        Row: {
          area: string | null
          balance_cents: number | null
          guest_count: number | null
          has_late_item: boolean | null
          has_no_drinks: boolean | null
          has_open_call: boolean | null
          has_pending_approval: boolean | null
          has_ready_waiting: boolean | null
          is_undecided: boolean | null
          label: string | null
          opened_at: string | null
          restaurant_id: string | null
          seats: number | null
          session_id: string | null
          short_code: string | null
          table_id: string | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      adjustment_type: "discount" | "service_fee_waiver"
      audit_actor_type: "staff" | "guest" | "system"
      diet_tag:
        | "vegetariano"
        | "vegano"
        | "sem_gluten"
        | "sem_lactose"
        | "apimentado"
      discount_type: "fixed_price" | "percent" | "buy_x_pay_y" | "free_item"
      menu_block_type:
        | "category"
        | "product"
        | "featured_group"
        | "banner"
        | "text"
        | "combo"
        | "drink_grid"
        | "spacer"
      menu_event_type: "view" | "add_to_cart" | "remove_from_cart"
      menu_layout_status: "draft" | "published"
      order_item_status:
        | "pending"
        | "queued"
        | "preparing"
        | "ready"
        | "delivered"
        | "cancelled"
        | "out_of_stock"
      order_source: "guest" | "waiter"
      order_status:
        | "pending_approval"
        | "approved"
        | "partially_approved"
        | "rejected"
        | "cancelled"
      payment_method: "pix" | "credito" | "debito" | "dinheiro" | "voucher"
      product_badge: "novo" | "mais_pedido" | "picante" | "da_casa"
      promotion_applies_to: "auto" | "staff_only"
      promotion_status: "draft" | "active" | "paused" | "expired"
      promotion_target_type: "product" | "category"
      rejection_reason: "acabou" | "cliente_desistiu" | "erro_no_pedido"
      release_reason:
        | "cliente_foi_embora_sem_pagar"
        | "mesa_aberta_por_engano"
        | "cortesia_da_casa"
        | "outro"
      session_status: "open" | "closing" | "closed" | "cancelled"
      staff_role: "owner" | "manager" | "waiter" | "kitchen" | "cashier"
      station: "cozinha" | "bar"
      waiter_call_status: "open" | "resolved" | "cancelled"
      waiter_call_type: "call_waiter" | "request_bill"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      adjustment_type: ["discount", "service_fee_waiver"],
      audit_actor_type: ["staff", "guest", "system"],
      diet_tag: [
        "vegetariano",
        "vegano",
        "sem_gluten",
        "sem_lactose",
        "apimentado",
      ],
      discount_type: ["fixed_price", "percent", "buy_x_pay_y", "free_item"],
      menu_block_type: [
        "category",
        "product",
        "featured_group",
        "banner",
        "text",
        "combo",
        "drink_grid",
        "spacer",
      ],
      menu_event_type: ["view", "add_to_cart", "remove_from_cart"],
      menu_layout_status: ["draft", "published"],
      order_item_status: [
        "pending",
        "queued",
        "preparing",
        "ready",
        "delivered",
        "cancelled",
        "out_of_stock",
      ],
      order_source: ["guest", "waiter"],
      order_status: [
        "pending_approval",
        "approved",
        "partially_approved",
        "rejected",
        "cancelled",
      ],
      payment_method: ["pix", "credito", "debito", "dinheiro", "voucher"],
      product_badge: ["novo", "mais_pedido", "picante", "da_casa"],
      promotion_applies_to: ["auto", "staff_only"],
      promotion_status: ["draft", "active", "paused", "expired"],
      promotion_target_type: ["product", "category"],
      rejection_reason: ["acabou", "cliente_desistiu", "erro_no_pedido"],
      release_reason: [
        "cliente_foi_embora_sem_pagar",
        "mesa_aberta_por_engano",
        "cortesia_da_casa",
        "outro",
      ],
      session_status: ["open", "closing", "closed", "cancelled"],
      staff_role: ["owner", "manager", "waiter", "kitchen", "cashier"],
      station: ["cozinha", "bar"],
      waiter_call_status: ["open", "resolved", "cancelled"],
      waiter_call_type: ["call_waiter", "request_bill"],
    },
  },
} as const

