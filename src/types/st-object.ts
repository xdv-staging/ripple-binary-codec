import { Buffer } from 'buffer/'
import { xAddressToClassicAddress, isValidXAddress } from 'ripple-address-codec'

import { Field, FieldInstance } from '../enums'
import BinaryParser from '../serdes/BinaryParser'
import BinarySerializer from '../serdes/BinarySerializer'
import BytesList from '../serdes/BytesList'

import SerializedType, { JsonObject, JSON } from './SerializedType'

const OBJECT_END_MARKER_BYTE = Buffer.from([0xe1])
const OBJECT_END_MARKER = 'ObjectEndMarker'
const ST_OBJECT = 'STObject'
const DESTINATION = 'Destination'
const ACCOUNT = 'Account'
const SOURCE_TAG = 'SourceTag'
const DEST_TAG = 'DestinationTag'

function handleXAddress(field: string, xAddress: string): JsonObject {
  const decoded = xAddressToClassicAddress(xAddress)

  let tagName
  if (field === DESTINATION) {
    tagName = DEST_TAG
  } else if (field === ACCOUNT) {
    tagName = SOURCE_TAG
  } else if (decoded.tag !== false) {
    throw new Error(`${field} cannot have an associated tag`)
  }

  return decoded.tag !== false
    ? { [field]: decoded.classicAddress, [tagName]: decoded.tag }
    : { [field]: decoded.classicAddress }
}

/**
 * Validate that two objects don't both have the same tag fields.
 *
 * @param obj1 - First object to check for tags.
 * @param obj2 - Second object to check for tags.
 * @throws When both objects have SourceTag or DestinationTag.
 */
function checkForDuplicateTags(obj1: JsonObject, obj2: JsonObject): void {
  if (!(obj1[SOURCE_TAG] === undefined || obj2[SOURCE_TAG] === undefined)) {
    throw new Error('Cannot have Account X-Address and SourceTag')
  }
  if (!(obj1[DEST_TAG] === undefined || obj2[DEST_TAG] === undefined)) {
    throw new Error('Cannot have Destination X-Address and DestinationTag')
  }
}

/**
 * Class for Serializing/Deserializing objects.
 */
export default class STObject extends SerializedType {
  /**
   * Construct a STObject from a BinaryParser.
   *
   * @param parser - BinaryParser to read STObject from.
   * @returns A STObject object.
   */
  static fromParser(parser: BinaryParser): STObject {
    const list: BytesList = new BytesList()
    const bytes: BinarySerializer = new BinarySerializer(list)

    while (!parser.end()) {
      const field = parser.readField()
      if (field.name === OBJECT_END_MARKER) {
        break
      }

      const associatedValue = parser.readFieldValue(field)

      bytes.writeFieldAndValue(field, associatedValue)
      if (field.type.name === ST_OBJECT) {
        bytes.put(OBJECT_END_MARKER_BYTE)
      }
    }

    return new STObject(list.toBytes())
  }

  /**
   * Construct a STObject from a JSON object.
   *
   * @param value - An object to include.
   * @param filter - Optional, denote which field to include in serialized object.
   * @returns A STObject object.
   */
  static from<T extends STObject | JsonObject>(
    value: T,
    filter?: (...any) => boolean,
  ): STObject {
    if (value instanceof STObject) {
      return value
    }

    const list: BytesList = new BytesList()
    const bytes: BinarySerializer = new BinarySerializer(list)

    const xAddressDecoded = Object.entries(value).reduce((acc, [key, val]) => {
      if (isValidXAddress(val)) {
        const handled = handleXAddress(key, val)
        checkForDuplicateTags(handled, value as JsonObject)
        return { ...acc, ...handled }
      }
      return { ...acc, [key]: val as JSON }
    }, {})

    let sorted = Object.keys(xAddressDecoded)
      .map((field: string): FieldInstance => Field.get(field))
      .filter(
        (field: FieldInstance): boolean =>
          field !== undefined &&
          xAddressDecoded[field.name] !== undefined &&
          field.isSerialized,
      )
      .sort((a, b) => {
        return a.ordinal - b.ordinal
      })

    if (filter !== undefined) {
      sorted = sorted.filter(filter)
    }

    sorted.forEach((field) => {
      const associatedValue = field.associatedType.from(
        xAddressDecoded[field.name],
      )

      bytes.writeFieldAndValue(field, associatedValue)
      if (field.type.name === ST_OBJECT) {
        bytes.put(OBJECT_END_MARKER_BYTE)
      }
    })

    return new STObject(list.toBytes())
  }

  /**
   * Get the JSON interpretation of this.bytes.
   *
   * @returns A JSON object.
   */
  toJSON(): JsonObject {
    const objectParser = new BinaryParser(this.toString())
    const accumulator = {}

    while (!objectParser.end()) {
      const field = objectParser.readField()
      if (field.name === OBJECT_END_MARKER) {
        break
      }
      accumulator[field.name] = objectParser.readFieldValue(field).toJSON()
    }

    return accumulator
  }
}
