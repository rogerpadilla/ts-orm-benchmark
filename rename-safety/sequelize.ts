import {
  col,
  type CreationOptional,
  DataTypes,
  type ForeignKey,
  fn,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  type NonAttribute,
  Op,
  type Sequelize,
  where,
} from 'sequelize';

export class Company extends Model<
  InferAttributes<Company>,
  InferCreationAttributes<Company>
> {
  declare id: CreationOptional<number>;
  declare staff?: NonAttribute<User[]>;
}

export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare emailAddress: string;
  declare employerId: ForeignKey<Company['id']>;
  declare employer?: NonAttribute<Company>;
}

declare const sequelize: Sequelize;

Company.init(
  { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true } },
  { sequelize },
);

User.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    emailAddress: DataTypes.STRING,
    // Generated column | n/a: Sequelize models declare no generated columns
  },
  {
    sequelize,
    indexes: [
      // Index on the field
      { fields: ['emailAddress'] },
      // Composite unique index
      { fields: ['emailAddress', 'employerId'], unique: true },
      // Covering index column | n/a: Sequelize's index options have no INCLUDE
      // Expression index
      { fields: [fn('lower', col('emailAddress'))] },
      // Partial index condition
      { fields: ['employerId'], where: { emailAddress: { [Op.ne]: '' } } },
    ],
    // Check constraint | n/a: Sequelize models declare no CHECK constraints
  },
);

// Foreign key of a relation
User.belongsTo(Company, { foreignKey: 'employerId', as: 'employer' });

// Inverse side of a relation
Company.hasMany(User, { foreignKey: 'employerId', as: 'staff' });

// Field in the projection
await User.findAll({ attributes: ['id', 'emailAddress'] });

// Field in the filter
await User.findAll({ where: { emailAddress: 'ada@example.com' } });

// Field in the sort
await User.findAll({ order: [['emailAddress', 'ASC']] });

// Field inside a loaded relation
await Company.findAll({
  include: [{ association: 'staff', attributes: ['emailAddress'] }],
});

// Relation loaded by name
await User.findAll({ include: ['employer'] });

// Field in inserted data
await User.create({ emailAddress: 'ada@example.com' });

// Field in updated data
await User.update({ emailAddress: 'ada@example.com' }, { where: { id: 1 } });

// Foreign key in a grouped count
await User.findAll({
  attributes: ['employerId', [fn('count', col('id')), 'total']],
  group: ['employerId'],
});

// Field read off the result
const [user] = await User.findAll();
export const address = user.emailAddress;

// Raw SQL in a filter
await User.findAll({
  where: where(fn('lower', col('emailAddress')), 'ada@example.com'),
});
