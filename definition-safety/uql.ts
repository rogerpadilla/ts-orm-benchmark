import { Computed, Entity, f, Field, filledKey, ManyToOne, OneToMany, sql, versionKey } from 'uql-orm';

@Entity()
export class Company {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) name!: string;

  // Inverse side naming a missing relation | user.compnay -> user.company
  @OneToMany({ entity: () => User, mappedBy: (user) => user.compnay })
  users?: User[];
}

@Entity({
  // Index on a missing column | emial -> email
  indexes: (user, index) => [index([user.emial])],
})
export class User {
  [versionKey]?: 'version';
  [filledKey]?: 'status' | 'createdAt';

  @Field(f.number().id()) id?: number;

  // Misspelled option on a column | nulable -> nullable
  @Field(f.string().nulable()) nickname?: string | null;

  // Nullable column declared always present | email!: string -> email?: string | null
  @Field(f.string().nullable()) email!: string;

  // Default outside the column's enum | 'archived' -> 'draft'
  @Field(f.enum(['draft', 'published']).default('archived')) status!: 'draft' | 'published';

  // Default of the wrong type | 'zero' -> 0
  @Field(f.number().default('zero')) createdAt!: number;

  // Text length on a numeric column | f.number().length(10) -> f.string().length(10)
  @Field(f.number().length(10)) code?: string;

  // Declared type disagreeing with its column | f.number() -> f.string()
  @Field(f.number()) name!: string;

  // Optimistic lock on a text column | f.string().version() -> f.version()
  @Field(f.string().version()) version?: number;

  // Generated column reading a misspelled column | nmae -> name
  @Computed((user) =>
    f
      .string()
      .as(sql`upper(${user.nmae})`)
      .stored(),
  )
  readonly shout?: string;

  // Foreign key of another type than the key it references | f.string().nullable().references(() => Company)) companyId?: string -> f.number().nullable().references(() => Company)) companyId?: number
  // oxfmt-ignore
  @Field(f.string().nullable().references(() => Company)) companyId?: string | null;

  // Foreign key naming a missing column | user.companyid -> user.companyId
  @ManyToOne({ entity: () => Company, references: (user) => user.companyid })
  company?: Company;
}
