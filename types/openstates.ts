export interface OpenStatesPerson {
  id?: string;
  name?: string;
  party?: string[];
  given_name?: string;
  family_name?: string;
  image?: string;
  email?: string;
  /** Always returned by /people; links and offices are only returned when requested via `include`. */
  openstates_url?: string;
  birth_date?: string;
  current_role?: {
    org_classification?: string;
    district?: string;
    jurisdiction?: {
      name?: string;
      classification?: string;
    };
  };
  offices?: Array<{
    voice?: string;
    address?: string;
  }>;
  links?: Array<{ url?: string }>;
}

export interface OpenStatesBill {
  id?: string;
  identifier?: string;
  title?: string;
  classification?: string[];
  from_organization?: { name?: string; classification?: string };
  abstracts?: Array<{ abstract?: string }>;
  other_titles?: Array<{ title?: string }>;
  subjects?: string[];
  latest_action_description?: string;
  latest_action_date?: string;
  created_at?: string;
  updated_at?: string;
  first_action_date?: string;
  latest_passage_date?: string;
  openstates_url?: string;
  sponsorships?: Array<{
    name?: string;
    person?: {
      id?: string;
      name?: string;
    };
    entity_type?: string;
    classification?: string;
    primary?: boolean;
  }>;
  actions?: Array<{
    date?: string;
    description?: string;
    organization?: {
      name?: string;
      classification?: string;
    };
    classification?: string[];
  }>;
  documents?: Array<{
    note?: string;
    date?: string;
    links?: Array<{
      media_type?: string;
      url?: string;
    }>;
  }>;
  votes?: OpenStatesVote[];
}

export interface OpenStatesCommittee {
  id?: string;
  name?: string;
  classification?: string;
  chamber?: string;
  parent?: string;
  /**
   * OCD id of the organization this committee hangs off -- the chamber for a top-level committee,
   * another committee for a subcommittee. It is the only chamber signal OpenStates provides, since
   * `chamber` is absent on committee payloads and the parent organization has no API endpoint.
   */
  parent_id?: string;
  email?: string;
  image?: string;
  members?: Array<{
    name?: string;
    role?: string;
    person_id?: string;
  }>;
  jurisdiction?: {
    name?: string;
    classification?: string;
  };
  links?: Array<{ url?: string }>;
}

export interface OpenStatesVote {
  id?: string;
  motion_text?: string;
  result?: string;
  start_date?: string;
  updated_at?: string;
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
