require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findFirst({
  where:{email:'shuvanan.m.islam@gmail.com'},
  select:{id:true, email:true, tier:true, passwordHash:true, name:true}
}).then(u => {
  console.log('User:', JSON.stringify({...u, passwordHash: u?.passwordHash ? '[SET]' : '[NULL]'}, null, 2));
  return prisma.$disconnect();
});
