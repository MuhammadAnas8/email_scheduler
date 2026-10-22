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
      connected_accounts: {
        Row: {
          connected_at: string
          created_at: string
          disconnected_at: string | null
          email: string
          id: string
          owner_id: string
          provider: string
          provider_subject: string
          status: string
          updated_at: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          email: string
          id?: string
          owner_id: string
          provider?: string
          provider_subject: string
          status?: string
          updated_at?: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          email?: string
          id?: string
          owner_id?: string
          provider?: string
          provider_subject?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          ended_at: string | null
          id: string
          outcome: string
          owner_id: string
          provider_message_id: string | null
          sanitized_error: string | null
          scheduled_email_id: string
          started_at: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          ended_at?: string | null
          id?: string
          outcome: string
          owner_id: string
          provider_message_id?: string | null
          sanitized_error?: string | null
          scheduled_email_id: string
          started_at: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          ended_at?: string | null
          id?: string
          outcome?: string
          owner_id?: string
          provider_message_id?: string | null
          sanitized_error?: string | null
          scheduled_email_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_attempts_email_owner_fkey"
            columns: ["owner_id", "scheduled_email_id"]
            isOneToOne: false
            referencedRelation: "scheduled_emails"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      email_batches: {
        Row: {
          attachment_path: string | null
          completed_at: string | null
          connected_account_id: string | null
          created_at: string
          id: string
          interval_seconds: number
          name: string
          owner_id: string
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attachment_path?: string | null
          completed_at?: string | null
          connected_account_id?: string | null
          created_at?: string
          id?: string
          interval_seconds?: number
          name: string
          owner_id: string
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attachment_path?: string | null
          completed_at?: string | null
          connected_account_id?: string | null
          created_at?: string
          id?: string
          interval_seconds?: number
          name?: string
          owner_id?: string
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_batches_connected_account_owner_fkey"
            columns: ["owner_id", "connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      scheduled_emails: {
        Row: {
          attempt_count: number
          batch_id: string
          body: string
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          owner_id: string
          position: number
          provider_message_id: string | null
          recipient: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          batch_id: string
          body: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          owner_id: string
          position: number
          provider_message_id?: string | null
          recipient: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          batch_id?: string
          body?: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          owner_id?: string
          position?: number
          provider_message_id?: string | null
          recipient?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_emails_batch_owner_fkey"
            columns: ["owner_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "email_batches"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_app_rate_limit: {
        Args: { p_action: string }
        Returns: boolean
      }
      create_draft_email_batch: {
        Args: { p_messages: Json; p_name: string }
        Returns: string
      }
      set_draft_attachment_path: {
        Args: { p_attachment_path: string; p_batch_id: string }
        Returns: boolean
      }
      schedule_email_batch: {
        Args: { p_batch_id: string; p_interval_seconds: number; p_starts_at: string | null }
        Returns: string
      }
      pause_email_batch: {
        Args: { p_batch_id: string }
        Returns: string
      }
      resume_email_batch: {
        Args: { p_batch_id: string }
        Returns: string
      }
      cancel_email_batch: {
        Args: { p_batch_id: string }
        Returns: string
      }
      skip_scheduled_email: {
        Args: { p_batch_id: string; p_message_id: string }
        Returns: string
      }
      get_email_batch_counts: {
        Args: Record<PropertyKey, never>
        Returns: {
          batch_id: string
          total_count: number
          pending_count: number
          skipped_count: number
          cancelled_count: number
          sent_count: number
          failed_count: number
          uncertain_count: number
        }[]
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

