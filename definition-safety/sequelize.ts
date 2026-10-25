import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  type NonAttribute,
  type Sequelize,
} from 'sequelize';

declare const sequelize: Sequelize;

export class Company extends Model<InferAttributes<Company>, InferCreationAttributes<Company>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare users?: NonAttribute<User[]>;
}

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare name: string;
  // Nullable column declared always present | declare email: string -> declare email: string | null
  declare email: string;
  declare status: CreationOptional<'draft' | 'published'>;
  declare createdAt: CreationOptional<number>;
  declare score: number | null;
  declare nickname: string | null;
  declare companyId: number | null;
}

Company.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize },
);

User.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Misspelled option on a column | allowNul -> allowNull
    name: { type: DataTypes.STRING, allowNul: false },

    email: { type: DataTypes.STRING },

    // Default outside the column's enum | 'archived' -> 'draft'
    status: {
      type: DataTypes.ENUM('draft', 'published'),
      defaultValue: 'archived',
    },

    // Default of the wrong type | 'zero' -> 0
    createdAt: { type: DataTypes.INTEGER, defaultValue: 'zero' },

    // Text length on a numeric column | DataTypes.INTEGER({ length: 10 }) -> DataTypes.DECIMAL({ precision: 10 })
    score: { type: DataTypes.INTEGER({ length: 10 }) },

    // Declared type disagreeing with its column | DataTypes.INTEGER -> DataTypes.STRING
    nickname: { type: DataTypes.INTEGER },

    // Foreign key of another type than the key it references | DataTypes.STRING -> DataTypes.INTEGER
    companyId: { type: DataTypes.STRING },
  },
  {
    sequelize,
    // Index on a missing column | emial -> email
    indexes: [{ fields: ['emial'] }],
  },
);

// Optimistic lock on a text column | n/a: Sequelize adds the version column itself, always an integer

// Generated column reading a misspelled column | n/a: Sequelize declares no generated columns

// Foreign key naming a missing column | 'companyid' -> 'companyId'
User.belongsTo(Company, { foreignKey: 'companyid', as: 'company' });

// Inverse side naming a missing relation | n/a: Sequelize pairs the two sides by foreign key, never by naming the other side
Company.hasMany(User, { foreignKey: 'companyId', as: 'users' });
