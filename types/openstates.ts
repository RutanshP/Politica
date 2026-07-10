export interface OpenStatesPerson {
  id?: string;
  name?: string;
  party?: string[];
  current_role?: {
    org_classification?: string;
    district?: string;
    jurisdiction?: {
      name?: string;
      classification?: string;
    };
  };
  links?: Array<{ url?: string }>;
}

export interface OpenStatesBill {
  id?: string;
  identifier?: string;
  title?: string;
  classification?: string[];
  from_organization?: { name?: string; classification?: string };
  abstracts?: Array<{ abstract?: string }>;
  subjects?: string[];
  latest_action_description?: string;
  latest_action_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OpenStatesVote {
  id?: string;
  motion_text?: string;
  result?: string;
  start_date?: string;
  counts?: Array<{ option?: string; value?: number }>;
  organization?: { name?: string; classification?: string };
  bill?: { identifier?: string };
  votes?: Array<{
    voter_name?: string;
    voter_id?: string;
    option?: string;
    party?: string;
  }>;
}
