import ExpoModulesCore
import MapKit

// Place search for the event form's Place sheet, using Apple Maps' own data
// (the same places the Maps app knows) instead of OpenStreetMap, which has far
// fewer local businesses.
//
// MapKit's search matches every word of the query against a place's name or
// address, and ranks text matches anywhere in the world above nearby ones.
// "Caruso's restaurant" therefore finds Caruso's Restaurant in Tucson but not
// Caruso's down the road, whose name doesn't say "restaurant". The Maps app is
// smarter than the public API here, so when a centre is given we merge:
//   1. the query, restricted to the area around the centre,
//   2. the query minus generic words ("restaurant", "cafe"…), same area,
//   3. the query anywhere (so an old trip's places are still findable).
//
// search(query, lat?, lng?) -> [{ name, address, lat, lng }]

private let nearbySpanMeters: CLLocationDistance = 60_000
private let maxResults = 10
private let genericWords: Set<String> = [
  "the", "restaurant", "restaurants", "cafe", "café", "coffee", "bar", "pub", "grill", "diner",
  "bakery", "pizzeria", "store", "shop", "hotel", "park",
]

public class HindsitePlacesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HindsitePlaces")

    AsyncFunction("search") { (query: String, lat: Double?, lng: Double?) async throws -> [[String: Any]] in
      // The iPhone keyboard types curly apostrophes; MapKit matches "Caruso’s"
      // to fewer places than "Caruso's".
      let query = query
        .replacingOccurrences(of: "\u{2019}", with: "'")
        .replacingOccurrences(of: "\u{2018}", with: "'")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard !query.isEmpty else { return [] }
      guard let lat, let lng else {
        return try await places(query, region: nil, nearbyOnly: false)
      }
      let region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
        latitudinalMeters: nearbySpanMeters,
        longitudinalMeters: nearbySpanMeters
      )
      let core = query
        .split(whereSeparator: \.isWhitespace)
        .filter { !genericWords.contains($0.lowercased()) }
        .joined(separator: " ")

      async let nearby = places(query, region: region, nearbyOnly: true)
      async let nearbyCore = places(core == query ? "" : core, region: region, nearbyOnly: true)
      async let anywhere = places(query, region: region, nearbyOnly: false)

      // A failed nearby pass just contributes nothing; the anywhere pass's
      // error is the one worth reporting.
      let merged = ((try? await nearby) ?? []) + ((try? await nearbyCore) ?? []) + (try await anywhere)
      var seen = Set<String>()
      return Array(merged.filter { seen.insert(key($0)).inserted }.prefix(maxResults))
    }
  }
}

private func places(_ query: String, region: MKCoordinateRegion?, nearbyOnly: Bool) async throws -> [[String: Any]] {
  if query.isEmpty { return [] }
  let request = MKLocalSearch.Request()
  request.naturalLanguageQuery = query
  request.resultTypes = [.pointOfInterest, .address]
  if let region {
    request.region = region
    if #available(iOS 18.0, *) {
      request.regionPriority = nearbyOnly ? .required : .default
    } else if nearbyOnly {
      return [] // can't restrict to the area before iOS 18; the anywhere pass still runs
    }
  }
  do {
    return try await MKLocalSearch(request: request).start().mapItems.map(place)
  } catch let error as MKError where error.code == .placemarkNotFound {
    return [] // "nothing found" is an empty list, not a failure
  }
}

// Same place from two passes: same name, within ~10 m.
private func key(_ p: [String: Any]) -> String {
  let name = (p["name"] as? String ?? "").lowercased()
  let lat = ((p["lat"] as? Double ?? 0) * 10_000).rounded()
  let lng = ((p["lng"] as? Double ?? 0) * 10_000).rounded()
  return "\(name)|\(lat)|\(lng)"
}

private func place(_ item: MKMapItem) -> [String: Any] {
  var result: [String: Any] = [:]
  let coordinate: CLLocationCoordinate2D
  var address: String?
  if #available(iOS 26.0, *) {
    coordinate = item.location.coordinate
    address = item.address?.fullAddress
  } else {
    coordinate = item.placemark.coordinate
    address = item.placemark.title
  }
  // fullAddress can be multi-line; the form shows it on one.
  address = address?
    .split(whereSeparator: \.isNewline)
    .map { $0.trimmingCharacters(in: .whitespaces) }
    .filter { !$0.isEmpty }
    .joined(separator: ", ")
  result["lat"] = coordinate.latitude
  result["lng"] = coordinate.longitude
  if let name = item.name, !name.isEmpty { result["name"] = name }
  if let address, !address.isEmpty { result["address"] = address }
  return result
}
