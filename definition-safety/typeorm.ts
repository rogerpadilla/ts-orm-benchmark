import { EntitySchema } from 'typeorm';

type Company = { id: number; name: string; users?: User[] };

type User = {
  id: number;
  name: string;
  // Nullable column declared always present | email: string -> email: string | null
  email: string;
  status: 'draft' | 'published';
  createdAt: number;
  score: number | null;
  nickname: string | null;
  version: number;
  shout: string;
  companyId: number | null;
  company?: Company;
};

export const CompanySchema = new EntitySchema<Company>({
  name: 'Company',
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: String },
  },
  relations: {
    // Inverse side naming a missing relation | 'compnay' -> 'company'
    users: { type: 'one-to-many', target: 'User', inverseSide: 'compnay' },
  },
});

export const UserSchema = new EntitySchema<User>({
  name: 'User',
  columns: {
    id: { type: Number, primary: true, generated: true },

    // Misspelled option on a column | nulable -> nullable
    name: { type: String, nulable: false },

    email: { type: String, nullable: true },

    // Default outside the column's enum | 'archived' -> 'draft'
    status: {
      type: 'enum',
      enum: ['draft', 'published'],
      default: 'archived',
    },

    // Default of the wrong type | 'zero' -> 0
    createdAt: { type: Number, default: 'zero' },

    // Text length on a numeric column | length: 10 -> precision: 10
    score: { type: Number, length: 10, nullable: true },

    // Declared type disagreeing with its column | type: Number -> type: String
    nickname: { type: Number, nullable: true },

    // Optimistic lock on a text column | type: String, version -> type: Number, version
    version: { type: String, version: true },

    // Generated column reading a misspelled column | nmae -> name
    shout: {
      type: String,
      generatedType: 'STORED',
      asExpression: 'upper("nmae")',
    },

    // Foreign key of another type than the key it references | type: String -> type: Number
    companyId: { type: String, nullable: true },
  },
  relations: {
    company: {
      type: 'many-to-one',
      target: 'Company',
      // Foreign key naming a missing column | 'companyid' -> 'companyId'
      joinColumn: { name: 'companyid' },
    },
  },

  // Index on a missing column | emial -> email
  indices: [{ columns: ['emial'] }],
});
