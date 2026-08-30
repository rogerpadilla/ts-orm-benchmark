import { Op } from 'sequelize';
import { clients } from './clients';

const { SqUser, SqCompany } = clients;

// Misspelled column in the projection | emial -> email
await SqUser.findAll({
  attributes: ['id', 'emial'],
});

// Misspelled column in the filter | companyid -> companyId
await SqUser.findAll({
  attributes: ['id'],
  where: { companyid: { [Op.gt]: 0 } },
});

// String value against a numeric column | 'one' -> 1
await SqUser.findAll({
  attributes: ['id'],
  where: { companyId: 'one' },
});

// Text operator against a numeric column | [Op.like]: 'abc' -> [Op.gte]: 1
await SqUser.findAll({
  attributes: ['id'],
  where: { companyId: { [Op.like]: 'abc' } },
});

// Misspelled column in the sort | idd -> id
await SqUser.findAll({
  attributes: ['id'],
  order: [['idd', 'ASC']],
});

// Misspelled column inside a loaded relation | nmae -> name
await SqCompany.findAll({
  attributes: ['id'],
  include: [{ model: SqUser, as: 'users', attributes: ['nmae'] }],
});

// Misspelled column in inserted data | emails -> email
await SqUser.bulkCreate([{ name: 'New User', emails: 'new@example.com', companyId: 1, createdAt: 1 }]);

// Number written into a text column | 42 -> 'Updated Name'
await SqUser.update({ name: 42 }, { where: { id: 1 } });

// Reading a column the projection left out | user.email -> user.name
const [user] = await SqUser.findAll({ attributes: ['id', 'name'] });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await SqCompany.findAll({
  attributes: ['id'],
  include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
});
export const nested = company.users![0].nmae;
