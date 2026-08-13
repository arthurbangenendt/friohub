export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_values: Json
          old_values: Json
          reason: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_values?: Json
          old_values?: Json
          reason: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_values?: Json
          old_values?: Json
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      city_billing_config: {
        Row: {
          cidade: string
          cobranca_ativa: boolean
          updated_at: string
        }
        Insert: {
          cidade: string
          cobranca_ativa?: boolean
          updated_at?: string
        }
        Update: {
          cidade?: string
          cobranca_ativa?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      client_reviews: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          job_id: string
          professional_id: string
          rating: number
          tags: string[]
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          job_id: string
          professional_id: string
          rating: number
          tags?: string[]
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          job_id?: string
          professional_id?: string
          rating?: number
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "client_reviews_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reviews_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_contact_consent: {
        Row: {
          consented_at: string
          conversation_id: string
          user_id: string
        }
        Insert: {
          consented_at?: string
          conversation_id: string
          user_id: string
        }
        Update: {
          consented_at?: string
          conversation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_contact_consent_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contact_consent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_contexts: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          job_id: string | null
          quote_request_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          job_id?: string | null
          quote_request_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          job_id?: string | null
          quote_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_contexts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contexts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contexts_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          job_id: string | null
          last_message_at: string | null
          professional_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          job_id?: string | null
          last_message_at?: string | null
          professional_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          job_id?: string | null
          last_message_at?: string | null
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_equipment: {
        Row: {
          brand: string | null
          capacity_btu: number | null
          created_at: string
          customer_id: string
          id: string
          installed_at: string | null
          kind: string
          model: string | null
          notes: string | null
          serial_number: string | null
          site_id: string | null
        }
        Insert: {
          brand?: string | null
          capacity_btu?: number | null
          created_at?: string
          customer_id: string
          id?: string
          installed_at?: string | null
          kind?: string
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          site_id?: string | null
        }
        Update: {
          brand?: string | null
          capacity_btu?: number | null
          created_at?: string
          customer_id?: string
          id?: string
          installed_at?: string | null
          kind?: string
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_equipment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_equipment_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "customer_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sites: {
        Row: {
          address: string
          cep: string | null
          created_at: string
          customer_id: string
          id: string
          label: string
        }
        Insert: {
          address: string
          cep?: string | null
          created_at?: string
          customer_id: string
          id?: string
          label: string
        }
        Update: {
          address?: string
          cep?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_areas: {
        Row: {
          cep_prefix: string | null
          created_at: string
          distributor_id: string
          id: string
          uf: string
        }
        Insert: {
          cep_prefix?: string | null
          created_at?: string
          distributor_id: string
          id?: string
          uf: string
        }
        Update: {
          cep_prefix?: string | null
          created_at?: string
          distributor_id?: string
          id?: string
          uf?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_areas_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      distributors: {
        Row: {
          ativo: boolean
          cidade: string
          cnpj: string | null
          created_at: string
          estado: string
          id: string
          prazo_entrega_dias: number
          razao_social: string
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          ativo?: boolean
          cidade: string
          cnpj?: string | null
          created_at?: string
          estado?: string
          id: string
          prazo_entrega_dias?: number
          razao_social: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          ativo?: boolean
          cidade?: string
          cnpj?: string | null
          created_at?: string
          estado?: string
          id?: string
          prazo_entrega_dias?: number
          razao_social?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distributors_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_pmoc_links: {
        Row: {
          equipment_id: string
          linked_at: string
          plan_id: string
        }
        Insert: {
          equipment_id: string
          linked_at?: string
          plan_id: string
        }
        Update: {
          equipment_id?: string
          linked_at?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_pmoc_links_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_pmoc_links_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pmoc_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_service_links: {
        Row: {
          equipment_id: string
          job_id: string
          linked_at: string
        }
        Insert: {
          equipment_id: string
          job_id: string
          linked_at?: string
        }
        Update: {
          equipment_id?: string
          job_id?: string
          linked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_service_links_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_service_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          categoria: string
          created_at: string
          data: string
          descricao: string | null
          id: string
          job_id: string | null
          professional_id: string
          valor: number
        }
        Insert: {
          categoria?: string
          created_at?: string
          data?: string
          descricao?: string | null
          id?: string
          job_id?: string | null
          professional_id: string
          valor: number
        }
        Update: {
          categoria?: string
          created_at?: string
          data?: string
          descricao?: string | null
          id?: string
          job_id?: string | null
          professional_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          flag_key: string
          id: string
          region_id: string | null
          rollout_percentage: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          flag_key: string
          id?: string
          region_id?: string | null
          rollout_percentage?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          flag_key?: string
          id?: string
          region_id?: string | null
          rollout_percentage?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "marketplace_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_placements: {
        Row: {
          ativo: boolean
          cidade: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          specialty: string
          starts_at: string
        }
        Insert: {
          ativo?: boolean
          cidade: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          specialty: string
          starts_at?: string
        }
        Update: {
          ativo?: boolean
          cidade?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          specialty?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_placements_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_accounts: {
        Row: {
          account_type: string
          active: boolean
          code: string
          name: string
        }
        Insert: {
          account_type: string
          active?: boolean
          code: string
          name: string
        }
        Update: {
          account_type?: string
          active?: boolean
          code?: string
          name?: string
        }
        Relationships: []
      }
      financial_journals: {
        Row: {
          charge_id: string | null
          created_at: string
          description: string
          external_event_id: string | null
          id: string
          idempotency_key: string
          journal_type: string
          occurred_at: string
          order_id: string
          posted_at: string
          reversal_of: string | null
        }
        Insert: {
          charge_id?: string | null
          created_at?: string
          description: string
          external_event_id?: string | null
          id?: string
          idempotency_key: string
          journal_type: string
          occurred_at: string
          order_id: string
          posted_at?: string
          reversal_of?: string | null
        }
        Update: {
          charge_id?: string | null
          created_at?: string
          description?: string
          external_event_id?: string | null
          id?: string
          idempotency_key?: string
          journal_type?: string
          occurred_at?: string
          order_id?: string
          posted_at?: string
          reversal_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_journals_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journals_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_status_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journals_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journals_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_journals_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: true
            referencedRelation: "financial_journals"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_postings: {
        Row: {
          account_code: string
          amount: number
          beneficiary_id: string | null
          created_at: string
          direction: string
          id: string
          journal_id: string
        }
        Insert: {
          account_code: string
          amount: number
          beneficiary_id?: string | null
          created_at?: string
          direction: string
          id?: string
          journal_id: string
        }
        Update: {
          account_code?: string
          amount?: number
          beneficiary_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          journal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_postings_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "financial_postings_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_postings_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "financial_journals"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reconciliation_items: {
        Row: {
          actual_value: number | null
          charge_id: string | null
          created_at: string
          details: Json
          divergence_type: string
          expected_value: number | null
          id: string
          order_id: string | null
          resolved_at: string | null
          run_id: string
        }
        Insert: {
          actual_value?: number | null
          charge_id?: string | null
          created_at?: string
          details?: Json
          divergence_type: string
          expected_value?: number | null
          id?: string
          order_id?: string | null
          resolved_at?: string | null
          run_id: string
        }
        Update: {
          actual_value?: number | null
          charge_id?: string | null
          created_at?: string
          details?: Json
          divergence_type?: string
          expected_value?: number | null
          id?: string
          order_id?: string | null
          resolved_at?: string | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_items_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_status_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "financial_reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reconciliation_runs: {
        Row: {
          checked_records: number
          divergence_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
        }
        Insert: {
          checked_records?: number
          divergence_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Update: {
          checked_records?: number
          divergence_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      follow_up_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "follow_up_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          due_at: string
          id: string
          notes: string | null
          outcome: string | null
          professional_id: string
          quote_request_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_at: string
          id?: string
          notes?: string | null
          outcome?: string | null
          professional_id: string
          quote_request_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          professional_id?: string
          quote_request_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_tasks_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_appointments: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          ends_at: string
          id: string
          job_id: string
          notes: string | null
          proposed_by: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          ends_at: string
          id?: string
          job_id: string
          notes?: string | null
          proposed_by: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          job_id?: string
          notes?: string | null
          proposed_by?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_appointments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_appointments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_appointments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          job_id: string
          metadata: Json
          reason: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          job_id: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          job_id?: string
          metadata?: Json
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          ambiente: string | null
          andar_ou_telhado: boolean | null
          area_m2: number | null
          btu_recomendado: number | null
          cep: string
          cidade: string
          cliente_id: string
          created_at: string
          descricao: string | null
          endereco: string | null
          has_equipment: boolean
          id: string
          insolacao_alta: boolean | null
          job_type: string
          num_pessoas: number | null
          produto_id: string | null
          profissional_id: string | null
          quote_request_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ambiente?: string | null
          andar_ou_telhado?: boolean | null
          area_m2?: number | null
          btu_recomendado?: number | null
          cep: string
          cidade: string
          cliente_id: string
          created_at?: string
          descricao?: string | null
          endereco?: string | null
          has_equipment?: boolean
          id?: string
          insolacao_alta?: boolean | null
          job_type: string
          num_pessoas?: number | null
          produto_id?: string | null
          profissional_id?: string | null
          quote_request_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ambiente?: string | null
          andar_ou_telhado?: boolean | null
          area_m2?: number | null
          btu_recomendado?: number | null
          cep?: string
          cidade?: string
          cliente_id?: string
          created_at?: string
          descricao?: string | null
          endereco?: string | null
          has_equipment?: boolean
          id?: string
          insolacao_alta?: boolean | null
          job_type?: string
          num_pessoas?: number | null
          produto_id?: string | null
          profissional_id?: string | null
          quote_request_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "meus_produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: true
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_recommendations: {
        Row: {
          created_at: string
          due_on: string
          equipment_id: string
          id: string
          professional_id: string
          reason: string
          reminder_consent: boolean
          status: string
        }
        Insert: {
          created_at?: string
          due_on: string
          equipment_id: string
          id?: string
          professional_id: string
          reason: string
          reminder_consent?: boolean
          status?: string
        }
        Update: {
          created_at?: string
          due_on?: string
          equipment_id?: string
          id?: string
          professional_id?: string
          reason?: string
          reminder_consent?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_recommendations_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_recommendations_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_regions: {
        Row: {
          active: boolean
          city: string
          config: Json
          created_at: string
          id: string
          launch_stage: string
          slug: string
          state: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          city: string
          config?: Json
          created_at?: string
          id?: string
          launch_stage?: string
          slug: string
          state: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string
          config?: Json
          created_at?: string
          id?: string
          launch_stage?: string
          slug?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempts: number
          available_at: string
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          recipient_id: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempts?: number
          available_at?: string
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          recipient_id: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempts?: number
          available_at?: string
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          recipient_id?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          job_updates: boolean
          messages: boolean
          quote_requests: boolean
          quotes: boolean
          reminders: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_enabled?: boolean
          job_updates?: boolean
          messages?: boolean
          quote_requests?: boolean
          quotes?: boolean
          reminders?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_enabled?: boolean
          job_updates?: boolean
          messages?: boolean
          quote_requests?: boolean
          quotes?: boolean
          reminders?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_cases: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          case_type: string
          details: Json
          id: string
          opened_at: string
          priority: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          case_type: string
          details?: Json
          id?: string
          opened_at?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          case_type?: string
          details?: Json
          id?: string
          opened_at?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          comissao_servico: number
          created_at: string
          id: string
          job_id: string
          margem_produto: number
          payment_ref: string | null
          payment_status: string
          preco_produto: number
          preco_servico: number
          total: number
        }
        Insert: {
          comissao_servico?: number
          created_at?: string
          id?: string
          job_id: string
          margem_produto?: number
          payment_ref?: string | null
          payment_status?: string
          preco_produto?: number
          preco_servico?: number
          total?: number
        }
        Update: {
          comissao_servico?: number
          created_at?: string
          id?: string
          job_id?: string
          margem_produto?: number
          payment_ref?: string | null
          payment_status?: string
          preco_produto?: number
          preco_servico?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          allocation_type: string
          amount: number
          beneficiary_id: string | null
          charge_id: string
          created_at: string
          id: string
        }
        Insert: {
          allocation_type: string
          amount: number
          beneficiary_id?: string | null
          charge_id: string
          created_at?: string
          id?: string
        }
        Update: {
          allocation_type?: string
          amount?: number
          beneficiary_id?: string | null
          charge_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "payment_status_cliente"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_charges: {
        Row: {
          amount: number
          billing_type: string
          checkout_url: string | null
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          due_date: string | null
          external_reference: string
          gateway: string
          gateway_payment_id: string | null
          id: string
          idempotency_key: string
          last_gateway_event_at: string | null
          order_id: string
          received_at: string | null
          refunded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          billing_type?: string
          checkout_url?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          due_date?: string | null
          external_reference: string
          gateway: string
          gateway_payment_id?: string | null
          id?: string
          idempotency_key: string
          last_gateway_event_at?: string | null
          order_id: string
          received_at?: string | null
          refunded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_type?: string
          checkout_url?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          due_date?: string | null
          external_reference?: string
          gateway?: string
          gateway_payment_id?: string | null
          id?: string
          idempotency_key?: string
          last_gateway_event_at?: string | null
          order_id?: string
          received_at?: string | null
          refunded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_charges_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charges_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charges_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_customers: {
        Row: {
          created_at: string
          external_reference: string
          gateway: string
          gateway_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_reference: string
          gateway: string
          gateway_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_reference?: string
          gateway?: string
          gateway_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_gateway_events: {
        Row: {
          amount: number | null
          attempts: number
          event_type: string
          gateway: string
          gateway_event_id: string
          gateway_payment_id: string | null
          id: string
          last_error: string | null
          occurred_at: string
          payload: Json
          processed_at: string | null
          processing_status: string
          received_at: string
        }
        Insert: {
          amount?: number | null
          attempts?: number
          event_type: string
          gateway: string
          gateway_event_id: string
          gateway_payment_id?: string | null
          id?: string
          last_error?: string | null
          occurred_at: string
          payload: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
        }
        Update: {
          amount?: number | null
          attempts?: number
          event_type?: string
          gateway?: string
          gateway_event_id?: string
          gateway_payment_id?: string | null
          id?: string
          last_error?: string | null
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
        }
        Relationships: []
      }
      plan_interest: {
        Row: {
          ciclo: string
          created_at: string
          id: string
          origem: string
          plan_id: string
          professional_id: string
        }
        Insert: {
          ciclo: string
          created_at?: string
          id?: string
          origem?: string
          plan_id: string
          professional_id: string
        }
        Update: {
          ciclo?: string
          created_at?: string
          id?: string
          origem?: string
          plan_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_interest_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_interest_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_config: {
        Row: {
          comissao_servico_pct: number
          id: boolean
          markup_produto_pct: number
          updated_at: string
        }
        Insert: {
          comissao_servico_pct?: number
          id?: boolean
          markup_produto_pct?: number
          updated_at?: string
        }
        Update: {
          comissao_servico_pct?: number
          id?: boolean
          markup_produto_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      pmoc_plan_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          plan_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          plan_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pmoc_plan_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmoc_plan_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pmoc_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      pmoc_plans: {
        Row: {
          cep: string
          cidade: string
          client_id: string
          company_name: string
          created_at: string
          equipment_count: number
          id: string
          interval_months: number
          next_due_date: string | null
          notes: string | null
          origin: string
          price_per_visit: number | null
          professional_id: string | null
          site_name: string
          status: string
          updated_at: string
        }
        Insert: {
          cep: string
          cidade: string
          client_id: string
          company_name: string
          created_at?: string
          equipment_count: number
          id?: string
          interval_months: number
          next_due_date?: string | null
          notes?: string | null
          origin?: string
          price_per_visit?: number | null
          professional_id?: string | null
          site_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          cep?: string
          cidade?: string
          client_id?: string
          company_name?: string
          created_at?: string
          equipment_count?: number
          id?: string
          interval_months?: number
          next_due_date?: string | null
          notes?: string | null
          origin?: string
          price_per_visit?: number | null
          professional_id?: string | null
          site_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pmoc_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pmoc_plans_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      pmoc_visits: {
        Row: {
          completed_at: string | null
          completion_notes: string | null
          created_at: string
          due_date: string
          id: string
          plan_id: string
          scheduled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          due_date: string
          id?: string
          plan_id: string
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          due_date?: string
          id?: string
          plan_id?: string
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pmoc_visits_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "pmoc_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_items: {
        Row: {
          caption: string | null
          created_at: string
          grupo_id: string | null
          id: string
          media_type: string
          momento: string | null
          position: number
          professional_id: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          grupo_id?: string | null
          id?: string
          media_type: string
          momento?: string | null
          position?: number
          professional_id: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          grupo_id?: string | null
          id?: string
          media_type?: string
          momento?: string | null
          position?: number
          professional_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          ativo: boolean
          btu: number
          categoria: string
          created_at: string
          custo: number
          distributor_id: string | null
          estoque_disponivel: boolean
          id: string
          image_url: string | null
          marca: string
          modelo: string
          preco_manual: boolean
          preco_venda: number
          supplier: string | null
        }
        Insert: {
          ativo?: boolean
          btu: number
          categoria?: string
          created_at?: string
          custo: number
          distributor_id?: string | null
          estoque_disponivel?: boolean
          id?: string
          image_url?: string | null
          marca: string
          modelo: string
          preco_manual?: boolean
          preco_venda?: number
          supplier?: string | null
        }
        Update: {
          ativo?: boolean
          btu?: number
          categoria?: string
          created_at?: string
          custo?: number
          distributor_id?: string | null
          estoque_disponivel?: boolean
          id?: string
          image_url?: string | null
          marca?: string
          modelo?: string
          preco_manual?: boolean
          preco_venda?: number
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_client_notes: {
        Row: {
          customer_id: string
          id: string
          notes: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          customer_id: string
          id?: string
          notes: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          customer_id?: string
          id?: string
          notes?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_client_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_client_notes_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_goals: {
        Row: {
          created_at: string
          id: string
          month: string
          professional_id: string
          revenue_target: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          professional_id: string
          revenue_target: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          professional_id?: string
          revenue_target?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_goals_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_skills: {
        Row: {
          created_at: string
          id: string
          jobs_completed: number
          professional_id: string
          rating_avg: number
          rating_count: number
          specialty: string
          years_experience: number
        }
        Insert: {
          created_at?: string
          id?: string
          jobs_completed?: number
          professional_id: string
          rating_avg?: number
          rating_count?: number
          specialty: string
          years_experience?: number
        }
        Update: {
          created_at?: string
          id?: string
          jobs_completed?: number
          professional_id?: string
          rating_avg?: number
          rating_count?: number
          specialty?: string
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_skills_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_tags: {
        Row: {
          created_at: string
          professional_id: string
          tag_slug: string
        }
        Insert: {
          created_at?: string
          professional_id: string
          tag_slug: string
        }
        Update: {
          created_at?: string
          professional_id?: string
          tag_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_tags_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_tags_tag_slug_fkey"
            columns: ["tag_slug"]
            isOneToOne: false
            referencedRelation: "skill_tags"
            referencedColumns: ["slug"]
          },
        ]
      }
      professionals: {
        Row: {
          anos_experiencia: number
          banner_url: string | null
          bio: string | null
          cidade: string
          cnpj: string | null
          created_at: string
          estado: string
          id: string
          razao_social: string | null
          subscription_plan_id: string | null
          subscription_status: string
          tipo: string
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          anos_experiencia?: number
          banner_url?: string | null
          bio?: string | null
          cidade: string
          cnpj?: string | null
          created_at?: string
          estado?: string
          id: string
          razao_social?: string | null
          subscription_plan_id?: string | null
          subscription_status?: string
          tipo: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          anos_experiencia?: number
          banner_url?: string | null
          bio?: string | null
          cidade?: string
          cnpj?: string | null
          created_at?: string
          estado?: string
          id?: string
          razao_social?: string | null
          subscription_plan_id?: string | null
          subscription_status?: string
          tipo?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professionals_plan_fk"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_private: {
        Row: {
          cpf_cnpj: string | null
          created_at: string
          id: string
          telefone: string | null
          termos_aceitos_em: string | null
          termos_versao: string | null
          updated_at: string
        }
        Insert: {
          cpf_cnpj?: string | null
          created_at?: string
          id: string
          telefone?: string | null
          termos_aceitos_em?: string | null
          termos_versao?: string | null
          updated_at?: string
        }
        Update: {
          cpf_cnpj?: string | null
          created_at?: string
          id?: string
          telefone?: string | null
          termos_aceitos_em?: string | null
          termos_versao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_private_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          nome: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          nome: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          nome?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          purchase_order_id: string
          status_anterior: string
          status_novo: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          purchase_order_id: string
          status_anterior: string
          status_novo: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          purchase_order_id?: string
          status_anterior?: string
          status_novo?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_events_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "entregas_cliente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_events_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          codigo_rastreio: string | null
          created_at: string
          custo_snapshot: number
          distributor_id: string
          id: string
          nota_fiscal_url: string | null
          order_id: string
          prazo_previsto: string | null
          status: string
          updated_at: string
        }
        Insert: {
          codigo_rastreio?: string | null
          created_at?: string
          custo_snapshot?: number
          distributor_id: string
          id?: string
          nota_fiscal_url?: string | null
          order_id: string
          prazo_previsto?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          codigo_rastreio?: string | null
          created_at?: string
          custo_snapshot?: number
          distributor_id?: string
          id?: string
          nota_fiscal_url?: string | null
          order_id?: string
          prazo_previsto?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_request_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          quote_request_id: string
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          quote_request_id: string
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          quote_request_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_request_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_request_events_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_request_photos: {
        Row: {
          created_at: string
          id: string
          quote_request_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          quote_request_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          quote_request_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_request_photos_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_request_targets: {
        Row: {
          enviado_em: string
          motivo_recusa: string | null
          professional_id: string
          quote_request_id: string
          recusado_em: string | null
          visto_em: string | null
        }
        Insert: {
          enviado_em?: string
          motivo_recusa?: string | null
          professional_id: string
          quote_request_id: string
          recusado_em?: string | null
          visto_em?: string | null
        }
        Update: {
          enviado_em?: string
          motivo_recusa?: string | null
          professional_id?: string
          quote_request_id?: string
          recusado_em?: string | null
          visto_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_request_targets_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_request_targets_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_requests: {
        Row: {
          bairro: string | null
          btu_recomendado: number | null
          cep: string
          cidade: string
          cliente_id: string
          created_at: string
          descricao: string | null
          detalhes: Json
          expira_em: string
          id: string
          job_type: string
          produto_id: string | null
          quantidade: number
          status: string
          updated_at: string
          urgencia: string | null
        }
        Insert: {
          bairro?: string | null
          btu_recomendado?: number | null
          cep: string
          cidade: string
          cliente_id: string
          created_at?: string
          descricao?: string | null
          detalhes?: Json
          expira_em?: string
          id?: string
          job_type: string
          produto_id?: string | null
          quantidade?: number
          status?: string
          updated_at?: string
          urgencia?: string | null
        }
        Update: {
          bairro?: string | null
          btu_recomendado?: number | null
          cep?: string
          cidade?: string
          cliente_id?: string
          created_at?: string
          descricao?: string | null
          detalhes?: Json
          expira_em?: string
          id?: string
          job_type?: string
          produto_id?: string | null
          quantidade?: number
          status?: string
          updated_at?: string
          urgencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_requests_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "meus_produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_requests_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          garantia_dias: number
          id: string
          inclui: string | null
          job_id: string | null
          nao_inclui: string | null
          observacoes: string | null
          prazo_execucao: string | null
          professional_id: string
          quote_request_id: string
          status: string
          tipo: string
          updated_at: string
          validade_ate: string
          valor_mao_obra: number
          valor_materiais: number
          valor_visita: number
          visita_abatida: boolean
        }
        Insert: {
          created_at?: string
          garantia_dias?: number
          id?: string
          inclui?: string | null
          job_id?: string | null
          nao_inclui?: string | null
          observacoes?: string | null
          prazo_execucao?: string | null
          professional_id: string
          quote_request_id: string
          status?: string
          tipo?: string
          updated_at?: string
          validade_ate?: string
          valor_mao_obra?: number
          valor_materiais?: number
          valor_visita?: number
          visita_abatida?: boolean
        }
        Update: {
          created_at?: string
          garantia_dias?: number
          id?: string
          inclui?: string | null
          job_id?: string | null
          nao_inclui?: string | null
          observacoes?: string | null
          prazo_execucao?: string | null
          professional_id?: string
          quote_request_id?: string
          status?: string
          tipo?: string
          updated_at?: string
          validade_ate?: string
          valor_mao_obra?: number
          valor_materiais?: number
          valor_visita?: number
          visita_abatida?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          expires_at: string
          hits: number
          scope: string
          subject_id: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          expires_at: string
          hits: number
          scope: string
          subject_id: string
          window_seconds: number
          window_start: string
        }
        Update: {
          expires_at?: string
          hits?: number
          scope?: string
          subject_id?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          cliente_id: string
          comment: string | null
          created_at: string
          id: string
          job_id: string
          professional_id: string
          rating: number
          specialty: string
        }
        Insert: {
          cliente_id: string
          comment?: string | null
          created_at?: string
          id?: string
          job_id: string
          professional_id: string
          rating: number
          specialty: string
        }
        Update: {
          cliente_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          job_id?: string
          professional_id?: string
          rating?: number
          specialty?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          cep_prefix: string
          cidade: string
          created_at: string
          id: string
          professional_id: string
        }
        Insert: {
          cep_prefix: string
          cidade: string
          created_at?: string
          id?: string
          professional_id: string
        }
        Update: {
          cep_prefix?: string
          cidade?: string
          created_at?: string
          id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      service_checklist_templates: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          items: Json
          job_type: string
          title: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          items: Json
          job_type: string
          title: string
          version: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          items?: Json
          job_type?: string
          title?: string
          version?: number
        }
        Relationships: []
      }
      service_executions: {
        Row: {
          checklist: Json
          evidence_paths: string[]
          finalized_at: string | null
          id: string
          job_id: string
          maintenance_due: string | null
          materials: Json
          measurements: Json
          notes: string | null
          professional_id: string
          started_at: string
          status: string
          template_id: string
          updated_at: string
          warranty_until: string | null
        }
        Insert: {
          checklist?: Json
          evidence_paths?: string[]
          finalized_at?: string | null
          id?: string
          job_id: string
          maintenance_due?: string | null
          materials?: Json
          measurements?: Json
          notes?: string | null
          professional_id: string
          started_at?: string
          status?: string
          template_id: string
          updated_at?: string
          warranty_until?: string | null
        }
        Update: {
          checklist?: Json
          evidence_paths?: string[]
          finalized_at?: string | null
          id?: string
          job_id?: string
          maintenance_due?: string | null
          materials?: Json
          measurements?: Json
          notes?: string | null
          professional_id?: string
          started_at?: string
          status?: string
          template_id?: string
          updated_at?: string
          warranty_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_executions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_executions_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "service_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      service_reports: {
        Row: {
          created_at: string
          created_by: string | null
          execution_id: string
          id: string
          snapshot: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          execution_id: string
          id?: string
          snapshot: Json
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          execution_id?: string
          id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_reports_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "service_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_tags: {
        Row: {
          ativo: boolean
          categoria: string
          label: string
          ordem: number
          slug: string
        }
        Insert: {
          ativo?: boolean
          categoria: string
          label: string
          ordem?: number
          slug: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          label?: string
          ordem?: number
          slug?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          ativo: boolean
          created_at: string
          destaque: boolean
          featured_cota: number
          features: Json
          headline: string | null
          id: string
          nome: string
          ordem: number
          preco_anual: number | null
          preco_mensal: number
          publico: boolean
          slug: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          destaque?: boolean
          featured_cota?: number
          features?: Json
          headline?: string | null
          id?: string
          nome: string
          ordem?: number
          preco_anual?: number | null
          preco_mensal: number
          publico?: boolean
          slug?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          destaque?: boolean
          featured_cota?: number
          features?: Json
          headline?: string | null
          id?: string
          nome?: string
          ordem?: number
          preco_anual?: number | null
          preco_mensal?: number
          publico?: boolean
          slug?: string | null
        }
        Relationships: []
      }
      system_health_checks: {
        Row: {
          checked_at: string
          component: string
          details: Json
          id: string
          observed_value: number | null
          run_id: string
          status: string
          threshold: number | null
        }
        Insert: {
          checked_at?: string
          component: string
          details?: Json
          id?: string
          observed_value?: number | null
          run_id: string
          status: string
          threshold?: number | null
        }
        Update: {
          checked_at?: string
          component?: string
          details?: Json
          id?: string
          observed_value?: number | null
          run_id?: string
          status?: string
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "system_health_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_health_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_runs: {
        Row: {
          finished_at: string
          id: string
          started_at: string
          status: string
        }
        Insert: {
          finished_at?: string
          id?: string
          started_at?: string
          status: string
        }
        Update: {
          finished_at?: string
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      entregas_cliente: {
        Row: {
          codigo_rastreio: string | null
          created_at: string | null
          distribuidora: string | null
          id: string | null
          job_id: string | null
          order_id: string | null
          prazo_previsto: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
        ]
      }
      meus_produtos: {
        Row: {
          ativo: boolean | null
          btu: number | null
          categoria: string | null
          created_at: string | null
          custo: number | null
          distributor_id: string | null
          estoque_disponivel: boolean | null
          id: string | null
          image_url: string | null
          marca: string | null
          modelo: string | null
          preco_manual: boolean | null
          preco_venda: number | null
        }
        Insert: {
          ativo?: boolean | null
          btu?: number | null
          categoria?: string | null
          created_at?: string | null
          custo?: number | null
          distributor_id?: string | null
          estoque_disponivel?: boolean | null
          id?: string | null
          image_url?: string | null
          marca?: string | null
          modelo?: string | null
          preco_manual?: boolean | null
          preco_venda?: number | null
        }
        Update: {
          ativo?: boolean | null
          btu?: number | null
          categoria?: string | null
          created_at?: string | null
          custo?: number | null
          distributor_id?: string | null
          estoque_disponivel?: boolean | null
          id?: string | null
          image_url?: string | null
          marca?: string | null
          modelo?: string | null
          preco_manual?: boolean | null
          preco_venda?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      orders_cliente: {
        Row: {
          created_at: string | null
          id: string | null
          job_id: string | null
          payment_status: string | null
          preco_produto: number | null
          preco_servico: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_status_cliente: {
        Row: {
          amount: number | null
          billing_type: string | null
          checkout_url: string | null
          confirmed_at: string | null
          created_at: string | null
          currency: string | null
          due_date: string | null
          id: string | null
          order_id: string | null
          received_at: string | null
          refunded_at: string | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          billing_type?: string | null
          checkout_url?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string | null
          order_id?: string | null
          received_at?: string | null
          refunded_at?: string | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          billing_type?: string | null
          checkout_url?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string | null
          order_id?: string | null
          received_at?: string | null
          refunded_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_charges_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charges_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_cliente"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abrir_conversa: { Args: { p_professional_id: string }; Returns: string }
      abrir_conversa_contextual: {
        Args: {
          p_job_id?: string
          p_professional_id: string
          p_quote_request_id?: string
        }
        Returns: string
      }
      aceitar_quote: {
        Args: { p_detalhes: Json; p_endereco: string; p_quote_id: string }
        Returns: string
      }
      adiar_follow_up: {
        Args: { p_due_at: string; p_task_id: string }
        Returns: undefined
      }
      atribuir_pmoc: {
        Args: { p_plan_id: string; p_professional_id: string }
        Returns: undefined
      }
      avaliar_saude_sistema: { Args: never; Returns: string }
      avancar_purchase_order: {
        Args: {
          p_codigo_rastreio?: string
          p_nota_fiscal_url?: string
          p_purchase_order_id: string
          p_status: string
        }
        Returns: {
          codigo_rastreio: string | null
          created_at: string
          custo_snapshot: number
          distributor_id: string
          id: string
          nota_fiscal_url: string | null
          order_id: string
          prazo_previsto: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      buscar_produtos_marketplace: {
        Args: {
          p_btu?: number
          p_limit?: number
          p_offset?: number
          p_query?: string
        }
        Returns: {
          btu: number
          categoria: string
          distribuidora: string
          image_url: string
          marca: string
          modelo: string
          preco_venda: number
          product_id: string
          total_count: number
        }[]
      }
      buscar_profissionais_marketplace: {
        Args: {
          p_cep: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_require_verified?: boolean
          p_sort?: string
          p_specialty?: string
        }
        Returns: {
          active_jobs: number
          avatar_url: string
          bio: string
          coverage_prefix_length: number
          destaque_em: string[]
          foto_url: string
          jobs_completed: number
          nome: string
          professional_id: string
          rating_score: number
          response_rate: number
          skills: Json
          tipo: string
          total_count: number
        }[]
      }
      cancelar_agendamento: {
        Args: { p_appointment_id: string; p_reason: string }
        Returns: undefined
      }
      cancelar_pedido_orcamento: {
        Args: { p_quote_request_id: string; p_reason: string }
        Returns: undefined
      }
      cancelar_pmoc: {
        Args: { p_plan_id: string; p_reason: string }
        Returns: undefined
      }
      cliente_da_purchase_order: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      concluir_follow_up: {
        Args: { p_notes?: string; p_outcome: string; p_task_id: string }
        Returns: undefined
      }
      concluir_visita_pmoc: {
        Args: { p_notes?: string; p_visit_id: string }
        Returns: undefined
      }
      consume_rate_limit: {
        Args: {
          p_max_hits: number
          p_scope: string
          p_subject_id: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      criar_follow_up: {
        Args: { p_due_at: string; p_quote_request_id: string; p_title?: string }
        Returns: string
      }
      criar_order: {
        Args: { p_job_id: string; p_preco_servico: number }
        Returns: string
      }
      criar_pedido_orcamento: {
        Args: {
          p_bairro: string
          p_btu_recomendado: number
          p_cep: string
          p_cidade: string
          p_descricao: string
          p_detalhes: Json
          p_fotos: string[]
          p_job_type: string
          p_produto_id: string
          p_profissionais_ids: string[]
          p_quantidade: number
          p_urgencia: string
        }
        Returns: string
      }
      definir_verificacao: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      destinatario_do_pedido: {
        Args: { p_quote_request_id: string }
        Returns: boolean
      }
      distribuidora_ativa: {
        Args: { p_distributor_id: string }
        Returns: boolean
      }
      dono_do_pedido: { Args: { p_quote_request_id: string }; Returns: boolean }
      eh_admin: { Args: never; Returns: boolean }
      enqueue_notification: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_available_at?: string
          p_dedupe_key: string
          p_event_type: string
          p_payload: Json
          p_recipient_id: string
        }
        Returns: string
      }
      feature_enabled: {
        Args: {
          p_flag_key: string
          p_region_slug?: string
          p_subject_id?: string
        }
        Returns: boolean
      }
      finalizar_execucao_servico: {
        Args: { p_job_id: string }
        Returns: string
      }
      handoff_liberado: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_featured_eligible: {
        Args: {
          p_min_jobs?: number
          p_min_rating?: number
          p_professional_id: string
          p_specialty: string
        }
        Returns: boolean
      }
      marcar_conversa_lida: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      obter_cnpj_distribuidora: {
        Args: { p_distributor_id: string }
        Returns: string
      }
      obter_funil_marketplace: {
        Args: { p_city?: string; p_days?: number }
        Returns: {
          accepted: number
          avg_first_response_minutes: number
          completed: number
          period_end: string
          period_start: string
          repeat_customers: number
          requested: number
          responded: number
          started: number
        }[]
      }
      obter_saude_publica: {
        Args: never
        Returns: {
          checked_at: string
          status: string
        }[]
      }
      pode_ler_foto_orcamento: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      pode_propor: { Args: { p_quote_request_id: string }; Returns: boolean }
      preparar_cobranca_order: {
        Args: {
          p_billing_type: string
          p_gateway: string
          p_idempotency_key: string
          p_order_id: string
        }
        Returns: string
      }
      processar_evento_gateway: {
        Args: { p_event_id: string }
        Returns: string
      }
      processar_eventos_gateway_pendentes: {
        Args: { p_limit?: number }
        Returns: number
      }
      processar_lembretes_agendamento: { Args: never; Returns: undefined }
      processar_operacao_marketplace: { Args: never; Returns: undefined }
      processar_pmoc_recorrente: { Args: never; Returns: undefined }
      profissional_atende_cep: {
        Args: { p_cep: string; p_professional_id: string }
        Returns: boolean
      }
      propor_agendamento: {
        Args: {
          p_ends_at: string
          p_job_id: string
          p_notes?: string
          p_starts_at: string
        }
        Returns: string
      }
      propor_pmoc_profissional: {
        Args: {
          p_cep: string
          p_cidade: string
          p_client_id: string
          p_company_name: string
          p_equipment_count: number
          p_first_due_date: string
          p_interval_months: number
          p_notes?: string
          p_price_per_visit: number
          p_site_name: string
        }
        Returns: string
      }
      recomendar_manutencao: {
        Args: { p_due_on: string; p_equipment_id: string; p_reason: string }
        Returns: string
      }
      reconciliar_financeiro: { Args: never; Returns: string }
      recusar_pedido_orcamento: {
        Args: { p_quote_request_id: string; p_reason: string }
        Returns: undefined
      }
      registrar_evento_gateway: {
        Args: {
          p_amount: number
          p_event_type: string
          p_gateway: string
          p_gateway_event_id: string
          p_gateway_payment_id: string
          p_occurred_at: string
          p_payload: Json
        }
        Returns: string
      }
      registrar_interesse_plano: {
        Args: { p_ciclo: string; p_slug: string }
        Returns: string
      }
      registrar_lancamento_financeiro: {
        Args: {
          p_charge_id: string
          p_description: string
          p_external_event_id: string
          p_idempotency_key: string
          p_journal_type: string
          p_lines: Json
          p_occurred_at: string
          p_order_id: string
          p_reversal_of?: string
        }
        Returns: string
      }
      responder_agendamento: {
        Args: { p_accept: boolean; p_appointment_id: string; p_reason?: string }
        Returns: undefined
      }
      responder_pmoc: {
        Args: {
          p_accept: boolean
          p_first_due_date?: string
          p_plan_id: string
          p_price_per_visit?: number
        }
        Returns: undefined
      }
      responder_proposta_pmoc: {
        Args: { p_accept: boolean; p_plan_id: string; p_reason?: string }
        Returns: undefined
      }
      revelar_contato: {
        Args: { p_conversation_id: string }
        Returns: {
          nome: string
          telefone: string
          whatsapp_url: string
        }[]
      }
      salvar_execucao_servico: {
        Args: {
          p_checklist: Json
          p_evidence_paths: string[]
          p_job_id: string
          p_maintenance_due: string
          p_materials: Json
          p_measurements: Json
          p_notes: string
          p_warranty_until: string
        }
        Returns: string
      }
      solicitar_pmoc: {
        Args: {
          p_cep: string
          p_cidade: string
          p_company_name: string
          p_equipment_count: number
          p_interval_months: number
          p_notes?: string
          p_site_name: string
        }
        Returns: string
      }
      vincular_cobranca_gateway: {
        Args: {
          p_charge_id: string
          p_checkout_url: string
          p_due_date: string
          p_gateway_payment_id: string
        }
        Returns: undefined
      }
      vincular_equipamento_pmoc: {
        Args: { p_equipment_id: string; p_plan_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

