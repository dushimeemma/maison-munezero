import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:http/http.dart' as http;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pdf;
import 'package:printing/printing.dart';
import 'api.dart';
import 'ui.dart';
import 'dart:convert';

Future<String?> uploadImage(BuildContext context, Api api) async {
  final image = await ImagePicker().pickImage(
    source: ImageSource.gallery,
    maxWidth: 2400,
    imageQuality: 90,
  );
  if (image == null) return null;
  final bytes = await image.readAsBytes();
  if (bytes.length > 5 * 1024 * 1024) {
    throw ApiException('Please choose an image smaller than 5 MB.');
  }
  // Refresh an expired access token before uploading. No merchant or media secret is sent to the client.
  await api.get('/notifications');
  final request = http.MultipartRequest(
    'POST',
    Uri.parse('${Api.base}/media/upload'),
  );
  request.headers['Authorization'] = 'Bearer ${api.access}';
  request.files.add(
    http.MultipartFile.fromBytes('file', bytes, filename: image.name),
  );
  final response = await http.Response.fromStream(
    await api.client.send(request).timeout(const Duration(seconds: 30)),
  );
  final data = jsonDecode(response.body);
  if (response.statusCode >= 400) {
    throw ApiException('${data['message'] ?? 'Image upload failed'}');
  }
  return data['url'];
}

Future<void> printReceipt(Map<String, dynamic> order) async {
  final font = pdf.Font.ttf(
    await rootBundle.load('assets/fonts/DejaVuSans.ttf'),
  );
  final document = pdf.Document(
    theme: pdf.ThemeData.withFont(
      base: font,
      bold: font,
      italic: font,
      boldItalic: font,
    ),
  );
  document.addPage(
    pdf.MultiPage(
      pageFormat: PdfPageFormat.a4,
      build: (_) => [
        pdf.Text(
          'MAISON MUNEZERO',
          style: pdf.TextStyle(fontSize: 24, fontWeight: pdf.FontWeight.bold),
        ),
        pdf.SizedBox(height: 12),
        pdf.Text('Order receipt MM-${order['number']}'),
        pdf.Text('Customer: ${order['customer_name']}'),
        pdf.Text('Date: ${dateLabel(order['created_at'])}'),
        pdf.SizedBox(height: 24),
        pdf.TableHelper.fromTextArray(
          headers: ['Piece', 'Size / Colour', 'Quantity', 'Price'],
          data: [
            for (final item in order['items'])
              [
                '${item['product_name']}',
                '${item['size'] ?? 'Custom'} / ${item['color'] ?? ''}',
                '${item['quantity']}',
                rwf(item['unit_price']),
              ],
          ],
        ),
        pdf.SizedBox(height: 24),
        pdf.Text('Subtotal: ${rwf(order['subtotal'])}'),
        pdf.Text('Tax: ${rwf(order['tax'])}'),
        pdf.Text('Delivery: ${rwf(order['delivery_fee'])}'),
        pdf.Text(
          'Total: ${rwf(order['total'])}',
          style: pdf.TextStyle(fontWeight: pdf.FontWeight.bold),
        ),
        pdf.Text('Paid: ${rwf(order['paid'])}'),
        pdf.Text(
          'Balance: ${rwf((order['total'] as num) - (order['paid'] as num))}',
        ),
        pdf.SizedBox(height: 24),
        pdf.Text('Payment and fulfilment status: ${label(order['status'])}'),
        pdf.SizedBox(height: 24),
        pdf.Text(
          'This order receipt is not an EBM fiscal invoice.',
          style: const pdf.TextStyle(fontSize: 10),
        ),
      ],
    ),
  );
  await Printing.layoutPdf(
    name: 'Maison-Munezero-MM-${order['number']}',
    onLayout: (_) => document.save(),
  );
}
