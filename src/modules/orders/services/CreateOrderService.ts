import { getCustomRepository } from "typeorm";
import AppError from "@shared/errors/AppError";
import Order from "../typeorm/entities/Orders";
import OrdersRepository from "../typeorm/repositories/OrdersRepository";
import CustomersRepository from "@modules/customers/typeorm/repositories/CustomersRepository";
import { ProductRepository } from "@modules/products/typeorm/repositories/ProductsRepository";
import RedisCache from "@shared/cache/RedisCache";

interface IProduct {
  id: string;
  quantity: number;
}

interface IRequest {
  customer_id: string;
  products: IProduct[];
}

class CreateOrderService {
  public async execute({ customer_id, products }: IRequest): Promise<Order> {
    const ordersRepository = getCustomRepository(OrdersRepository);
    const customerRepository = getCustomRepository(CustomersRepository);
    const productsRepository = getCustomRepository(ProductRepository);

    const customerExists = await customerRepository.findById(customer_id);

    if (!customerExists) {
      throw new AppError("Customer not found!");
    }

    const existProducts = await productsRepository.findAllById(products);

    if (!existProducts.length) {
      throw new AppError("No products found!");
    }

    const existProductsIds = existProducts.map(product => product.id);

    const checkInexistentProducts = products.filter(
      product => !existProductsIds.includes(product.id),
    );

    if (checkInexistentProducts.length) {
      throw new AppError(
        `Could not find product ${checkInexistentProducts[0].id}`,
      );
    }

    const quantityAvaliable = products.filter(
      product =>
        existProducts.filter(p => p.id === product.id)[0].quantity <
        product.quantity,
    );

    if (quantityAvaliable.length) {
      throw new AppError(
        `The quantity ${quantityAvaliable[0].quantity} is not avaliable for ${quantityAvaliable[0].id}`,
      );
    }

    const serializedProducts = products.map(product => ({
      product_id: product.id,
      quantity: product.quantity,
      price: existProducts.filter(p => p.id === product.id)[0].price,
    }));

    const order = await ordersRepository.createOrder({
      customer: customerExists,
      products: serializedProducts,
    });

    const { order_products } = order;

    const updatedProductQuantity = order_products.map(product => ({
      id: product.product_id,
      quantity:
        existProducts.filter(p => p.id === product.product_id)[0].quantity -
        product.quantity,
    }));

    await productsRepository.save(updatedProductQuantity);

    const redisCache = new RedisCache();

    await redisCache.invalidate("api-vendas-PRODUCT_LIST");

    return order;
  }
}

export default CreateOrderService;
