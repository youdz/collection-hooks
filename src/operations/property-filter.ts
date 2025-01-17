// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  PropertyFilterOperator,
  PropertyFilterOperatorExtended,
  PropertyFilterQuery,
  PropertyFilterToken,
  UseCollectionOptions,
  PropertyFilterProperty,
} from '../interfaces';
import { compareDates, compareTimestamps } from '../date-utils/compare-dates.js';
import { Predicate } from './compose-filters';

const filterUsingOperator = (
  itemValue: any,
  tokenValue: any,
  { operator, match }: PropertyFilterOperatorExtended<any>
) => {
  if (match === 'date' || match === 'datetime') {
    const comparator = match === 'date' ? compareDates : compareTimestamps;
    const comparisonResult = comparator(itemValue, tokenValue);
    switch (operator) {
      case '<':
        return comparisonResult < 0;
      case '<=':
        return comparisonResult <= 0;
      case '>':
        return comparisonResult > 0;
      case '>=':
        return comparisonResult >= 0;
      case '=':
        return comparisonResult === 0;
      case '!=':
        return comparisonResult !== 0;
      default:
        return false;
    }
  } else if (typeof match === 'function') {
    return match(itemValue, tokenValue);
  } else if (match) {
    throw new Error('Unsupported `operator.match` type given.');
  }

  switch (operator) {
    case '<':
      return itemValue < tokenValue;
    case '<=':
      return itemValue <= tokenValue;
    case '>':
      return itemValue > tokenValue;
    case '>=':
      return itemValue >= tokenValue;
    case '=':
      // eslint-disable-next-line eqeqeq
      return itemValue == tokenValue;
    case '!=':
      // eslint-disable-next-line eqeqeq
      return itemValue != tokenValue;
    case ':':
      return (itemValue + '').toLowerCase().indexOf((tokenValue + '').toLowerCase()) > -1;
    case '!:':
      return (itemValue + '').toLowerCase().indexOf((tokenValue + '').toLowerCase()) === -1;
    case '^':
      return (itemValue + '').toLowerCase().startsWith((tokenValue + '').toLowerCase());
    case '!^':
      return !(itemValue + '').toLowerCase().startsWith((tokenValue + '').toLowerCase());
    // The unsupported operators result in an exception being thrown.
    // The exception can be avoided if using the match function.
    default:
      throw new Error('Unsupported operator given.');
  }
};

function freeTextFilter<T>(
  value: string,
  item: T,
  operator: PropertyFilterOperator,
  filteringPropertiesMap: FilteringPropertiesMap<T>
): boolean {
  const matches = Object.keys(filteringPropertiesMap).some(propertyKey => {
    const { operators } = filteringPropertiesMap[propertyKey as keyof typeof filteringPropertiesMap];
    return (
      !!operators[operator] && filterUsingOperator(item[propertyKey as keyof typeof item], value, { operator: ':' })
    );
  });
  return operator === ':' ? matches : !matches;
}

function filterByToken<T>(token: PropertyFilterToken, item: T, filteringPropertiesMap: FilteringPropertiesMap<T>) {
  if (token.propertyKey) {
    // token refers to a unknown property or uses an unsupported operator
    if (
      !(token.propertyKey in filteringPropertiesMap) ||
      !(token.operator in filteringPropertiesMap[token.propertyKey as keyof FilteringPropertiesMap<T>].operators)
    ) {
      return false;
    }
    const operator =
      filteringPropertiesMap[token.propertyKey as keyof FilteringPropertiesMap<T>].operators[token.operator];
    const itemValue: any = operator?.match
      ? item[token.propertyKey as keyof T]
      : fixupFalsyValues(item[token.propertyKey as keyof T]);
    return filterUsingOperator(itemValue, token.value, operator ?? { operator: token.operator });
  }
  return freeTextFilter(token.value, item, token.operator, filteringPropertiesMap);
}

function defaultFilteringFunction<T>(filteringPropertiesMap: FilteringPropertiesMap<T>) {
  return (item: T, { tokens, operation }: PropertyFilterQuery) => {
    let result = operation === 'and' ? true : !tokens.length;
    for (const token of tokens) {
      result =
        operation === 'and'
          ? result && filterByToken(token, item, filteringPropertiesMap)
          : result || filterByToken(token, item, filteringPropertiesMap);
    }
    return result;
  };
}

type FilteringPropertiesMap<T> = {
  [key in keyof T]: {
    operators: FilteringOperatorsMap;
  };
};

type FilteringOperatorsMap = {
  [key in PropertyFilterOperator]?: PropertyFilterOperatorExtended<any>;
};

export function createPropertyFilterPredicate<T>(
  propertyFiltering: UseCollectionOptions<T>['propertyFiltering'],
  query: PropertyFilterQuery = { tokens: [], operation: 'and' }
): null | Predicate<T> {
  if (!propertyFiltering) {
    return null;
  }
  const filteringPropertiesMap = propertyFiltering.filteringProperties.reduce<FilteringPropertiesMap<T>>(
    (acc: FilteringPropertiesMap<T>, { key, operators, defaultOperator }: PropertyFilterProperty) => {
      const operatorMap: FilteringOperatorsMap = { [defaultOperator ?? '=']: { operator: defaultOperator ?? '=' } };
      operators?.forEach(op => {
        if (typeof op === 'string') {
          operatorMap[op] = { operator: op };
        } else {
          operatorMap[op.operator] = { operator: op.operator, match: op.match };
        }
      });
      acc[key as keyof T] = {
        operators: operatorMap,
      };
      return acc;
    },
    {} as FilteringPropertiesMap<T>
  );
  const filteringFunction = propertyFiltering.filteringFunction || defaultFilteringFunction(filteringPropertiesMap);
  return item => filteringFunction(item, query);
}

export const fixupFalsyValues = <T>(value: T): T | string => {
  if (typeof value === 'boolean') {
    return value + '';
  }
  if (value || (value as any as number) === 0) {
    return value;
  }
  return '';
};

// Keeping this function as there are customers depending on it.
export function propertyFilter<T>(
  items: ReadonlyArray<T>,
  query: PropertyFilterQuery,
  propertyFiltering: NonNullable<UseCollectionOptions<T>['propertyFiltering']>
): ReadonlyArray<T> {
  const predicate = createPropertyFilterPredicate(propertyFiltering, query);
  return predicate ? items.filter(predicate) : items;
}
