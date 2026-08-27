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
      app_settings: {
        Row: {
          chave: string
          valor: string
        }
        Insert: {
          chave: string
          valor: string
        }
        Update: {
          chave?: string
          valor?: string
        }
        Relationships: []
      }
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
      auth_throttle: {
        Row: {
          chave: string
          janela: string
          tentativas: number
        }
        Insert: {
          chave: string
          janela: string
          tentativas?: number
        }
        Update: {
          chave?: string
          janela?: string
          tentativas?: number
        }
        Relationships: []
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
      customer_cashback_ledger: {
        Row: {
          amount_cents: number
          available_at: string
          base_cents: number | null
          created_at: string
          customer_id: string
          id: string
          kind: Database["public"]["Enums"]["cashback_kind"]
          pct: number | null
          restaurant_id: string
          session_id: string | null
        }
        Insert: {
          amount_cents: number
          available_at?: string
          base_cents?: number | null
          created_at?: string
          customer_id: string
          id?: string
          kind: Database["public"]["Enums"]["cashback_kind"]
          pct?: number | null
          restaurant_id: string
          session_id?: string | null
        }
        Update: {
          amount_cents?: number
          available_at?: string
          base_cents?: number | null
          created_at?: string
          customer_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["cashback_kind"]
          pct?: number | null
          restaurant_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_cashback_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "publico_de_marketing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_bills"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ready_pass"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_totals"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_cashback_ledger_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_status"
            referencedColumns: ["session_id"]
          },
        ]
      }
      customers: {
        Row: {
          cpf: string
          cpf_mask: string | null
          created_at: string
          email: string | null
          id: string
          marketing_consent_text: string | null
          marketing_opt_in_at: string | null
          marketing_opt_out_at: string | null
          name: string
          password_hash: string
          phone: string | null
          phone_mask: string | null
          restaurant_id: string
          unsubscribe_token: string | null
          updated_at: string
        }
        Insert: {
          cpf: string
          cpf_mask?: string | null
          created_at?: string
          email?: string | null
          id?: string
          marketing_consent_text?: string | null
          marketing_opt_in_at?: string | null
          marketing_opt_out_at?: string | null
          name: string
          password_hash: string
          phone?: string | null
          phone_mask?: string | null
          restaurant_id: string
          unsubscribe_token?: string | null
          updated_at?: string
        }
        Update: {
          cpf?: string
          cpf_mask?: string | null
          created_at?: string
          email?: string | null
          id?: string
          marketing_consent_text?: string | null
          marketing_opt_in_at?: string | null
          marketing_opt_out_at?: string | null
          name?: string
          password_hash?: string
          phone?: string | null
          phone_mask?: string | null
          restaurant_id?: string
          unsubscribe_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      diet_restrictions: {
        Row: {
          active: boolean
          built_in: boolean
          color: string
          created_at: string
          id: string
          label: string
          label_long: string
          restaurant_id: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          built_in?: boolean
          color?: string
          created_at?: string
          id?: string
          label: string
          label_long: string
          restaurant_id: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          built_in?: boolean
          color?: string
          created_at?: string
          id?: string
          label?: string
          label_long?: string
          restaurant_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diet_restrictions_restaurant_id_fkey"
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
            referencedRelation: "customer_directory"
            referencedColumns: ["guest_id", "restaurant_id"]
          },
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
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
      message_campaign_targets: {
        Row: {
          campaign_id: string
          created_at: string
          customer_id: string
          error_message: string | null
          id: string
          message: string
          motivo: string | null
          restaurant_id: string
          send_order: number | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          customer_id: string
          error_message?: string | null
          id?: string
          message: string
          motivo?: string | null
          restaurant_id: string
          send_order?: number | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          customer_id?: string
          error_message?: string | null
          id?: string
          message?: string
          motivo?: string | null
          restaurant_id?: string
          send_order?: number | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campanhas_com_progresso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "message_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaign_targets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaign_targets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "publico_de_marketing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaign_targets_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_campaigns: {
        Row: {
          corpo: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          next_send_at: string | null
          restaurant_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          corpo: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_send_at?: string | null
          restaurant_id: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          corpo?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_send_at?: string | null
          restaurant_id?: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_campaigns_restaurant_id_fkey"
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
            referencedRelation: "kitchen_queue"
            referencedColumns: ["item_id", "restaurant_id"]
          },
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
            foreignKeyName: "order_item_modifiers_order_item_id_restaurant_id_fkey"
            columns: ["order_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "ready_pass"
            referencedColumns: ["item_id", "restaurant_id"]
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
            referencedRelation: "customer_directory"
            referencedColumns: ["guest_id", "restaurant_id"]
          },
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
            referencedRelation: "approval_queue"
            referencedColumns: ["order_id", "restaurant_id"]
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
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
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
            referencedRelation: "promotion_performance"
            referencedColumns: ["promotion_id", "restaurant_id"]
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
            referencedRelation: "customer_directory"
            referencedColumns: ["guest_id", "restaurant_id"]
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
      product_badges: {
        Row: {
          active: boolean
          animation: string
          built_in: boolean
          color: string
          created_at: string
          id: string
          label: string
          restaurant_id: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          animation?: string
          built_in?: boolean
          color?: string
          created_at?: string
          id?: string
          label: string
          restaurant_id: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          animation?: string
          built_in?: boolean
          color?: string
          created_at?: string
          id?: string
          label?: string
          restaurant_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_badges_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
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
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
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
          badges: string[]
          category_id: string
          created_at: string
          description: string | null
          diet_tags: string[]
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
          badges?: string[]
          category_id: string
          created_at?: string
          description?: string | null
          diet_tags?: string[]
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
          badges?: string[]
          category_id?: string
          created_at?: string
          description?: string | null
          diet_tags?: string[]
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
          operator_code: string | null
          permissions: string[]
          restaurant_id: string
          roles: Database["public"]["Enums"]["staff_role"][]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          name: string
          operator_code?: string | null
          permissions?: string[]
          restaurant_id: string
          roles?: Database["public"]["Enums"]["staff_role"][]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          operator_code?: string | null
          permissions?: string[]
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
            referencedRelation: "promotion_performance"
            referencedColumns: ["promotion_id", "restaurant_id"]
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
      restaurant_briefing: {
        Row: {
          created_at: string
          expires_at: string
          respostas: Json
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          respostas: Json
          restaurant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          respostas?: Json
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_briefing_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
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
          briefing_at: string | null
          cashback_pct: number
          created_at: string
          currency: string
          evolution_instance_name: string | null
          expires_at: string | null
          id: string
          logo_url: string | null
          marketing_max_por_dia: number
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
          briefing_at?: string | null
          cashback_pct?: number
          created_at?: string
          currency?: string
          evolution_instance_name?: string | null
          expires_at?: string | null
          id?: string
          logo_url?: string | null
          marketing_max_por_dia?: number
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
          briefing_at?: string | null
          cashback_pct?: number
          created_at?: string
          currency?: string
          evolution_instance_name?: string | null
          expires_at?: string | null
          id?: string
          logo_url?: string | null
          marketing_max_por_dia?: number
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
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
          customer_id: string | null
          device_hash: string | null
          display_name: string
          id: string
          joined_at: string
          lgpd_consent_at: string | null
          phone: string | null
          phone_mask: string | null
          restaurant_id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          device_hash?: string | null
          display_name: string
          id?: string
          joined_at?: string
          lgpd_consent_at?: string | null
          phone?: string | null
          phone_mask?: string | null
          restaurant_id: string
          session_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          device_hash?: string | null
          display_name?: string
          id?: string
          joined_at?: string
          lgpd_consent_at?: string | null
          phone?: string | null
          phone_mask?: string | null
          restaurant_id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_guests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "publico_de_marketing"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
      approval_queue: {
        Row: {
          created_at: string | null
          esperando_segundos: number | null
          guest_name: string | null
          order_id: string | null
          restaurant_id: string | null
          session_id: string | null
          source: Database["public"]["Enums"]["order_source"] | null
          table_area: string | null
          table_id: string | null
          table_label: string | null
        }
        Relationships: [
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
      campanhas_com_progresso: {
        Row: {
          corpo: string | null
          created_at: string | null
          enviados: number | null
          falharam: number | null
          finished_at: string | null
          id: string | null
          last_error: string | null
          next_send_at: string | null
          pendentes: number | null
          pulados: number | null
          restaurant_id: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string | null
          titulo: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_campaigns_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_directory: {
        Row: {
          guest_id: string | null
          joined_at: string | null
          lgpd_consent_at: string | null
          nome: string | null
          opened_at: string | null
          restaurant_id: string | null
          sessao_status: Database["public"]["Enums"]["session_status"] | null
          session_id: string | null
          telefone_mascarado: string | null
          tem_telefone: boolean | null
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
            referencedRelation: "open_bills"
            referencedColumns: ["session_id", "restaurant_id"]
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
      daily_sales: {
        Row: {
          bruto_cents: number | null
          comandas: number | null
          desconto_manual_cents: number | null
          desconto_promocao_cents: number | null
          dia: string | null
          pessoas: number | null
          recebido_cents: number | null
          restaurant_id: string | null
          taxa_servico_cents: number | null
          ticket_medio_cents: number | null
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
        ]
      }
      kitchen_performance: {
        Row: {
          atrasados: number | null
          dia: string | null
          estacao: Database["public"]["Enums"]["station"] | null
          itens: number | null
          mediana_fila_seg: number | null
          mediana_seg: number | null
          p90_seg: number | null
          restaurant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_queue: {
        Row: {
          cliente: string | null
          course: number | null
          em_preparo_segundos: number | null
          item_id: string | null
          mesa: string | null
          na_fila_segundos: number | null
          notes: string | null
          prep_minutes: number | null
          produto: string | null
          qty: number | null
          queued_at: string | null
          restaurant_id: string | null
          session_id: string | null
          started_at: string | null
          station: Database["public"]["Enums"]["station"] | null
          status: Database["public"]["Enums"]["order_item_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
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
      open_bills: {
        Row: {
          aberta_ha_segundos: number | null
          area: string | null
          balance_cents: number | null
          discount_cents: number | null
          em_producao: number | null
          garcom: string | null
          guest_count: number | null
          mesa: string | null
          opened_at: string | null
          paid_cents: number | null
          pediu_a_conta: boolean | null
          pending_cents: number | null
          pessoas: number | null
          restaurant_id: string | null
          service_fee_cents: number | null
          service_fee_waived: boolean | null
          session_id: string | null
          status: Database["public"]["Enums"]["session_status"] | null
          subtotal_cents: number | null
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
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
          },
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
      payment_mix: {
        Row: {
          dia: string | null
          method: Database["public"]["Enums"]["payment_method"] | null
          quantidade: number | null
          restaurant_id: string | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_effective_prices: {
        Row: {
          badge_color: string | null
          badge_label: string | null
          category_id: string | null
          discount_type: Database["public"]["Enums"]["discount_type"] | null
          effective_price_cents: number | null
          ends_at: string | null
          list_price_cents: number | null
          max_quantity: number | null
          product_id: string | null
          promotion_id: string | null
          remaining_quantity: number | null
          restaurant_id: string | null
          time_from: string | null
          time_to: string | null
        }
        Relationships: [
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
      product_sales: {
        Row: {
          categoria: string | null
          desconto_cents: number | null
          dia: string | null
          product_id: string | null
          produto: string | null
          quantidade: number | null
          receita_cents: number | null
          restaurant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
          },
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
      promotion_performance: {
        Row: {
          desconto_cents: number | null
          discount_type: Database["public"]["Enums"]["discount_type"] | null
          itens: number | null
          max_quantity: number | null
          priority: number | null
          promocao: string | null
          promotion_id: string | null
          receita_cents: number | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["promotion_status"] | null
          unidades: number | null
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
      publico_de_marketing: {
        Row: {
          id: string | null
          marketing_consent_text: string | null
          marketing_opt_in_at: string | null
          name: string | null
          phone_mask: string | null
          restaurant_id: string | null
        }
        Insert: {
          id?: string | null
          marketing_consent_text?: string | null
          marketing_opt_in_at?: string | null
          name?: string | null
          phone_mask?: string | null
          restaurant_id?: string | null
        }
        Update: {
          id?: string | null
          marketing_consent_text?: string | null
          marketing_opt_in_at?: string | null
          name?: string | null
          phone_mask?: string | null
          restaurant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_pass: {
        Row: {
          area: string | null
          cliente: string | null
          esperando_segundos: number | null
          estacao: Database["public"]["Enums"]["station"] | null
          item_id: string | null
          mesa: string | null
          modificadores: string[] | null
          notes: string | null
          produto: string | null
          qty: number | null
          ready_at: string | null
          restaurant_id: string | null
          session_id: string | null
          table_id: string | null
          tempo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      rejected_items: {
        Row: {
          desfecho: Database["public"]["Enums"]["order_item_status"] | null
          dia: string | null
          motivo: Database["public"]["Enums"]["rejection_reason"] | null
          ocorrencias: number | null
          product_id: string | null
          produto: string | null
          restaurant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_product_id_restaurant_id_fkey"
            columns: ["product_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "product_effective_prices"
            referencedColumns: ["product_id", "restaurant_id"]
          },
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
          cashback_cents: number | null
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
      staff_money_actions: {
        Row: {
          acao: string | null
          dia: string | null
          funcionario: string | null
          ocorrencias: number | null
          profile_id: string | null
          restaurant_id: string | null
          total_cents: number | null
        }
        Relationships: []
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
      aceitar_marketing: { Args: { p_customer: string }; Returns: boolean }
      adicionar_bloco: {
        Args: { p_config?: Json; p_tipo: string }
        Returns: string
      }
      aplicar_briefing: { Args: { p_respostas: Json }; Returns: Json }
      apply_discount: {
        Args: {
          p_amount_cents?: number
          p_percent?: number
          p_reason: string
          p_session_id: string
        }
        Returns: Json
      }
      approve_order: {
        Args: {
          p_aprovados: string[]
          p_order_id: string
          p_recusas?: Json
          p_reter_cursos?: number[]
        }
        Returns: Json
      }
      archive_product: {
        Args: { p_arquivar?: boolean; p_product_id: string }
        Returns: undefined
      }
      atualizar_bloco: {
        Args: { p_bloco: string; p_config?: Json; p_oculto?: boolean }
        Returns: undefined
      }
      atualizar_configuracoes: { Args: { p_valores: Json }; Returns: Json }
      autenticar_cliente: {
        Args: { p_cpf: string; p_restaurante: string; p_senha: string }
        Returns: string
      }
      blocos_do_cardapio: { Args: { p_restaurante: string }; Returns: Json }
      cadastrar_cliente: {
        Args: {
          p_cpf: string
          p_email?: string
          p_nome: string
          p_restaurante: string
          p_senha: string
          p_telefone?: string
        }
        Returns: string
      }
      concluir_envio: {
        Args: { p_alvo: string; p_erro?: string; p_ok: boolean }
        Returns: boolean
      }
      create_guest_order: {
        Args: {
          p_guest_id: string
          p_idempotency_key: string
          p_items: Json
          p_session_id: string
        }
        Returns: string
      }
      create_restaurant: {
        Args: {
          p_nome: string
          p_nome_do_administrador: string
          p_timezone?: string
        }
        Returns: Json
      }
      create_tables: {
        Args: { p_area?: string; p_prefixo?: string; p_quantidade: number }
        Returns: number
      }
      descadastrar_marketing: { Args: { p_token: string }; Returns: boolean }
      desfazer_resgate: {
        Args: { p_cliente: string; p_sessao: string }
        Returns: Json
      }
      dono_do_token: {
        Args: { p_token: string }
        Returns: {
          ja_saiu: boolean
          nome: string
          restaurante: string
        }[]
      }
      ensure_draft_layout: { Args: never; Returns: string }
      gerar_demonstracao: { Args: never; Returns: Json }
      iniciar_campanha: {
        Args: { p_campanha: string; p_quando?: string }
        Returns: number
      }
      kds_item_ready: { Args: { p_item_id: string }; Returns: undefined }
      kds_out_of_stock: {
        Args: { p_item_id: string; p_marcar_indisponivel?: boolean }
        Returns: Json
      }
      kds_start_item: { Args: { p_item_id: string }; Returns: undefined }
      liberar_freio_de_login: {
        Args: { p_hash_conta: string }
        Returns: undefined
      }
      login_permitido: {
        Args: { p_hash_conta: string; p_hash_origem: string }
        Returns: boolean
      }
      marcar_como_demonstracao: { Args: never; Returns: string }
      mark_item_delivered: { Args: { p_item_id: string }; Returns: undefined }
      montar_publico: { Args: { p_campanha: string }; Returns: number }
      mover_bloco: {
        Args: { p_bloco: string; p_direcao: string }
        Returns: undefined
      }
      open_guest_session: {
        Args: {
          p_device_hash: string
          p_display_name: string
          p_lgpd_consent: boolean
          p_phone: string
          p_short_code: string
        }
        Returns: Json
      }
      parar_campanha: {
        Args: { p_campanha: string; p_definitivo?: boolean }
        Returns: boolean
      }
      promover_agendadas: { Args: never; Returns: number }
      publish_menu_layout: { Args: never; Returns: Json }
      register_payment: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_session_id: string
          p_tendered_cents?: number
        }
        Returns: Json
      }
      registrar_falha_de_login: {
        Args: { p_hash_conta: string; p_hash_origem: string }
        Returns: undefined
      }
      release_course: {
        Args: { p_course: number; p_session_id: string }
        Returns: number
      }
      release_table: {
        Args: {
          p_forcada?: boolean
          p_motivo?: Database["public"]["Enums"]["release_reason"]
          p_observacao?: string
          p_session_id: string
        }
        Returns: Json
      }
      remover_bloco: { Args: { p_bloco: string }; Returns: undefined }
      remover_do_marketing: { Args: { p_customer: string }; Returns: boolean }
      reservar_proximo_envio: {
        Args: never
        Returns: {
          alvo: string
          campanha: string
          instancia: string
          mensagem: string
          restaurante: string
          telefone: string
        }[]
      }
      resgatar_cashback: {
        Args: { p_cliente: string; p_sessao: string }
        Returns: Json
      }
      resolve_waiter_call: { Args: { p_call_id: string }; Returns: undefined }
      reveal_guest_phone: { Args: { p_guest_id: string }; Returns: string }
      revert_menu_layout: { Args: { p_version: number }; Returns: Json }
      saldo_disponivel_do_cliente: {
        Args: { p_cliente: string }
        Returns: number
      }
      saldo_em_carencia_do_cliente: {
        Args: { p_cliente: string }
        Returns: number
      }
      set_menu_permissions: {
        Args: { p_permissions: string[]; p_profile_id: string }
        Returns: undefined
      }
      teto_de_resgate_do_cliente: {
        Args: { p_cliente: string; p_sessao: string }
        Returns: number
      }
      unaccent_simples: { Args: { p_texto: string }; Returns: string }
      waive_service_fee: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
    }
    Enums: {
      adjustment_type: "discount" | "service_fee_waiver" | "cashback"
      audit_actor_type: "staff" | "guest" | "system"
      cashback_kind: "credito" | "resgate"
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
      menu_layout_status: "draft" | "published" | "archived"
      order_item_status:
        | "pending"
        | "held"
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
      adjustment_type: ["discount", "service_fee_waiver", "cashback"],
      audit_actor_type: ["staff", "guest", "system"],
      cashback_kind: ["credito", "resgate"],
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
      menu_layout_status: ["draft", "published", "archived"],
      order_item_status: [
        "pending",
        "held",
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

